import { authenticateMerchant } from "./mainnet-billing.js";
import { childSafetyResponse } from "./child-safety.js";

const EVENT_ID = /^[A-Za-z0-9._:-]{8,160}$/;
const SESSION_ID = /^[A-Za-z0-9._:-]{8,160}$/;
const MAX_REQUEST_BYTES = 20_000_000;
const MAX_IMAGE_BASE64 = 6_000_000;
const MAX_AUDIO_BASE64 = 8_000_000;
const MAX_VIDEO_FRAMES = 6;
const MAX_VIDEO_FRAME_BASE64 = 2_000_000;
const MAX_VIDEO_FRAME_TOTAL_BASE64 = 8_000_000;
const MAX_TRANSCRIPT = 20_000;

const MEDIA_FEES_MICRO_USD = {
  image: 15_000,
  audio: 10_000,
  video: 20_000,
} as const;

type MediaKind = keyof typeof MEDIA_FEES_MICRO_USD;

type ChildSafetyDelegate = (
  request: Request,
  env: MediaEnv,
) => Promise<Response | null>;

interface MediaEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

interface EncodedMedia {
  base64?: string;
  mimeType?: string;
}

interface VideoFrame extends EncodedMedia {
  timestampMs?: number;
}

interface MediaScanInput {
  eventId?: string;
  riskSessionId?: string;
  language?: string;
  childLikely?: boolean;
  childAgeBand?: string;
  signals?: string[];
  image?: EncodedMedia;
  audio?: EncodedMedia;
  frames?: VideoFrame[];
  transcript?: string;
}

export async function childSafetyMediaResponse(
  request: Request,
  env: MediaEnv,
  delegate: ChildSafetyDelegate = childSafetyResponse,
): Promise<Response | null> {
  const url = new URL(request.url);
  const kind = mediaKindFromPath(url.pathname);
  if (kind === null) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: apiHeaders() });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = bearerToken(authorization);
  if (!token) return json({ error: "unauthorized" }, 401);
  const merchant = await authenticateMerchant(env.DB, token);
  if (merchant === null) return json({ error: "unauthorized" }, 401);

  const input = await readInput(request);
  if (input instanceof Response) return input;

  const eventId = clean(input.eventId, 160);
  const riskSessionId = clean(input.riskSessionId, 160);
  if (!EVENT_ID.test(eventId)) return json({ error: "invalid_event_id" }, 400);
  if (riskSessionId && !SESSION_ID.test(riskSessionId)) {
    return json({ error: "invalid_risk_session_id" }, 400);
  }

  const feeMicroUsd = MEDIA_FEES_MICRO_USD[kind];
  const prior = await existingScan(env.DB, merchant.merchantId, eventId);
  if (prior) {
    return delegatePreparedScan(
      request,
      env,
      delegate,
      input,
      eventId,
      riskSessionId,
      kind,
      "Previously analyzed media event.",
    );
  }

  const balance = await merchantAvailableBalance(env.DB, merchant.merchantId);
  if (balance < feeMicroUsd) {
    return json(
      {
        error: "payment_required",
        feeMicroUsd,
        feeUsd: (feeMicroUsd / 1_000_000).toFixed(3),
        topUp: "/v1/topups/intents",
      },
      402,
    );
  }

  try {
    const derivedText = await deriveSafetyText(kind, input, env);
    if (!derivedText.trim()) {
      return json({ error: "media_analysis_empty" }, 422);
    }
    return delegatePreparedScan(
      request,
      env,
      delegate,
      input,
      eventId,
      riskSessionId,
      kind,
      derivedText,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "child_safety_media_scan_failed",
        merchantId: merchant.merchantId,
        eventId,
        mediaKind: kind,
        detail: errorCode(error),
      }),
    );
    return json({ error: "media_scan_unavailable" }, 503);
  }
}

async function deriveSafetyText(
  kind: MediaKind,
  input: MediaScanInput,
  env: MediaEnv,
): Promise<string> {
  if (kind === "image") {
    const image = requireImage(input.image);
    const summary = await analyzeImage(env, image);
    return `Safety-relevant visual summary of uploaded image:\n${summary}`;
  }

  if (kind === "audio") {
    const audio = requireAudio(input.audio);
    const transcript = await transcribeAudio(
      env,
      audio,
      clean(input.language, 80),
    );
    return `Temporary transcription of uploaded audio for child-safety classification:\n${clean(transcript, MAX_TRANSCRIPT)}`;
  }

  const frames = requireVideoFrames(input.frames);
  const summaries = await Promise.all(
    frames.map(async (frame, index) => {
      const summary = await analyzeImage(env, frame);
      const timestamp =
        Number.isFinite(frame.timestampMs) && Number(frame.timestampMs) >= 0
          ? ` at ${Math.floor(Number(frame.timestampMs))}ms`
          : "";
      return `Frame ${index + 1}${timestamp}: ${summary}`;
    }),
  );

  let audioTranscript = "";
  if (input.audio?.base64) {
    const audio = requireAudio(input.audio);
    audioTranscript = await transcribeAudio(
      env,
      audio,
      clean(input.language, 80),
    );
  }

  const suppliedTranscript = clean(input.transcript, MAX_TRANSCRIPT);
  return [
    "Safety-relevant sampled-video analysis.",
    ...summaries,
    audioTranscript
      ? `Temporary transcription of the video's audio:\n${clean(audioTranscript, MAX_TRANSCRIPT)}`
      : "",
    suppliedTranscript
      ? `Platform-supplied video transcript/captions:\n${suppliedTranscript}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TRANSCRIPT);
}

async function analyzeImage(
  env: MediaEnv,
  media: EncodedMedia,
): Promise<string> {
  const base64 = cleanBase64(media.base64, MAX_IMAGE_BASE64);
  const mimeType = normalizeImageMime(media.mimeType);
  const dataUri = `data:${mimeType};base64,${base64}`;
  const result = await env.AI.run("@cf/moondream/moondream3.1-9B-A2B", {
    task: "query",
    image: dataUri,
    question:
      "For child-safety moderation only, identify whether this image contains sexualized or explicit material, nudity or sexual context, grooming-related visual cues, coercive or threatening content, or another risk to a child or minor. Give a short non-explicit factual summary. Do not reproduce sexual detail and do not infer facts that are not visible.",
    reasoning: false,
    stream: false,
    temperature: 0.1,
    max_tokens: 320,
  });
  const text = aiText(result);
  if (!text) throw new Error("image_model_empty_response");
  return clean(text, 2_000);
}

async function transcribeAudio(
  env: MediaEnv,
  media: EncodedMedia,
  language: string,
): Promise<string> {
  const base64 = cleanBase64(media.base64, MAX_AUDIO_BASE64);
  const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64,
    task: "transcribe",
    ...(language ? { language } : {}),
    vad_filter: true,
    condition_on_previous_text: false,
    initial_prompt:
      "Transcribe accurately for a child-safety moderation system. Do not add or invent speech.",
  });
  const text = aiText(result);
  if (!text) throw new Error("audio_model_empty_response");
  return clean(text, MAX_TRANSCRIPT);
}

async function delegatePreparedScan(
  original: Request,
  env: MediaEnv,
  delegate: ChildSafetyDelegate,
  input: MediaScanInput,
  eventId: string,
  riskSessionId: string,
  kind: MediaKind,
  derivedText: string,
): Promise<Response> {
  const contentKind =
    kind === "image"
      ? "image_description"
      : kind === "video"
        ? "video_transcript"
        : "chat_window";
  const signals = Array.isArray(input.signals)
    ? input.signals
        .slice(0, 19)
        .map((value) => clean(value, 120))
        .filter(Boolean)
    : [];
  signals.push(`xguard_raw_${kind}_scan`);

  const synthetic = new Request(
    `${new URL(original.url).origin}/v1/child-safety/scan`,
    {
      method: "POST",
      headers: {
        Authorization: original.headers.get("authorization") ?? "",
        "Content-Type": "application/json",
        "X-XGuard-Media-Scan": kind,
      },
      body: JSON.stringify({
        eventId,
        ...(riskSessionId ? { riskSessionId } : {}),
        contentKind,
        language: clean(input.language, 80),
        childLikely: input.childLikely === true,
        childAgeBand: clean(input.childAgeBand, 40),
        signals,
        text: clean(derivedText, MAX_TRANSCRIPT),
      }),
    },
  );

  const decision = await delegate(synthetic, env);
  if (decision === null)
    return json({ error: "media_delegate_unavailable" }, 503);
  if (!decision.ok) return decision;

  const body: unknown = await decision.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return decision;
  return json({
    ...(body as Record<string, unknown>),
    mediaScan: {
      kind,
      rawMediaStored: false,
      preprocessing:
        kind === "image"
          ? "vision"
          : kind === "audio"
            ? "speech_to_text"
            : "sampled_frames_plus_audio",
      videoFrameCount:
        kind === "video" ? (input.frames?.length ?? 0) : undefined,
    },
  });
}

function requireImage(value: EncodedMedia | undefined): EncodedMedia {
  if (!value) throw new Error("image_required");
  cleanBase64(value.base64, MAX_IMAGE_BASE64);
  normalizeImageMime(value.mimeType);
  return value;
}

function requireAudio(value: EncodedMedia | undefined): EncodedMedia {
  if (!value) throw new Error("audio_required");
  cleanBase64(value.base64, MAX_AUDIO_BASE64);
  normalizeAudioMime(value.mimeType);
  return value;
}

function requireVideoFrames(value: VideoFrame[] | undefined): VideoFrame[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("video_frames_required");
  if (value.length > MAX_VIDEO_FRAMES) throw new Error("too_many_video_frames");
  let total = 0;
  for (const frame of value) {
    const base64 = cleanBase64(frame.base64, MAX_VIDEO_FRAME_BASE64);
    normalizeImageMime(frame.mimeType);
    total += base64.length;
  }
  if (total > MAX_VIDEO_FRAME_TOTAL_BASE64)
    throw new Error("video_frames_too_large");
  return value;
}

async function readInput(request: Request): Promise<MediaScanInput | Response> {
  const length = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES)
    return json({ error: "request_too_large" }, 413);
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      return json({ error: "invalid_json_object" }, 400);
    return value as MediaScanInput;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
}

function mediaKindFromPath(pathname: string): MediaKind | null {
  if (pathname === "/v1/child-safety/media/image") return "image";
  if (pathname === "/v1/child-safety/media/audio") return "audio";
  if (pathname === "/v1/child-safety/media/video") return "video";
  return null;
}

async function existingScan(
  db: D1Database,
  merchantId: string,
  eventId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS found FROM child_safety_scans WHERE merchant_id=? AND external_event_id=? LIMIT 1",
    )
    .bind(merchantId, eventId)
    .first<{ found: number }>();
  return row !== null;
}

async function merchantAvailableBalance(
  db: D1Database,
  merchantId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT available_balance_micro_usd FROM merchants WHERE merchant_id=? AND active=1",
    )
    .bind(merchantId)
    .first<{ available_balance_micro_usd: number }>();
  return Math.max(0, Number(row?.available_balance_micro_usd ?? 0));
}

function bearerToken(authorization: string): string {
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return "";
  return authorization.slice(prefix.length).trim();
}

function cleanBase64(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("base64_required");
  const text = value.trim();
  if (!text) throw new Error("base64_required");
  if (text.length > maxLength) throw new Error("media_too_large");
  return text;
}

function normalizeImageMime(value: unknown): string {
  const mime = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime))
    return mime === "image/jpg" ? "image/jpeg" : mime;
  throw new Error("unsupported_image_mime_type");
}

function normalizeAudioMime(value: unknown): string {
  const mime = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/m4a",
    ].includes(mime)
  ) {
    return mime;
  }
  throw new Error("unsupported_audio_mime_type");
}

function aiText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const object = result as Record<string, unknown>;
  for (const key of ["answer", "caption", "text", "response"]) {
    if (typeof object[key] === "string" && String(object[key]).trim())
      return String(object[key]);
  }
  const transcription = object.transcription_info;
  if (transcription && typeof transcription === "object") {
    const text = (transcription as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function errorCode(error: unknown): string {
  return error instanceof Error ? clean(error.message, 160) : "unknown_error";
}

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: apiHeaders() });
}
