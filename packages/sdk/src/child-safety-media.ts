import type {
  ChildSafetyClientOptions,
  ChildSafetyScanResult,
} from "./child-safety.js";

export interface ChildSafetyEncodedMedia {
  base64: string;
  mimeType: string;
}

export interface ChildSafetyVideoFrame extends ChildSafetyEncodedMedia {
  timestampMs?: number;
}

export interface ChildSafetyMediaContext {
  eventId: string;
  riskSessionId?: string;
  language?: string;
  childLikely?: boolean;
  childAgeBand?: string;
  signals?: string[];
}

export interface ChildSafetyImageScanInput extends ChildSafetyMediaContext {
  image: ChildSafetyEncodedMedia;
}

export interface ChildSafetyAudioScanInput extends ChildSafetyMediaContext {
  audio: ChildSafetyEncodedMedia;
}

export interface ChildSafetyVideoScanInput extends ChildSafetyMediaContext {
  frames: ChildSafetyVideoFrame[];
  audio?: ChildSafetyEncodedMedia;
  transcript?: string;
}

export interface ChildSafetyMediaScanResult extends ChildSafetyScanResult {
  mediaScan: {
    kind: "image" | "audio" | "video";
    rawMediaStored: false;
    preprocessing: "vision" | "speech_to_text" | "sampled_frames_plus_audio";
    videoFrameCount?: number;
  };
}

export interface ChildSafetyMediaClient {
  scanImage(
    input: ChildSafetyImageScanInput,
  ): Promise<ChildSafetyMediaScanResult>;
  scanAudio(
    input: ChildSafetyAudioScanInput,
  ): Promise<ChildSafetyMediaScanResult>;
  scanVideo(
    input: ChildSafetyVideoScanInput,
  ): Promise<ChildSafetyMediaScanResult>;
}

export function createChildSafetyMediaClient(
  options: ChildSafetyClientOptions,
): ChildSafetyMediaClient {
  const baseUrl = normalizeBaseUrl(options.url);
  const apiKey = options.apiKey.trim();
  if (apiKey.length > 256 || !/^xg_live_[A-Za-z0-9_-]{40,}$/.test(apiKey)) {
    throw new TypeError("A valid XGuard merchant API key is required");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const post = async (
    kind: "image" | "audio" | "video",
    body: unknown,
  ): Promise<ChildSafetyMediaScanResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        `${baseUrl}/v1/child-safety/media/${kind}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-XGuard-SDK": "@xguard/sdk-child-safety-media/0.1",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(
          `XGuard child-safety media request failed with HTTP ${response.status}`,
        );
        error.name = "ChildSafetyMediaApiError";
        throw error;
      }
      return validateMediaResult(payload, kind);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    scanImage(input) {
      validateContext(input);
      validateEncodedMedia(input.image, "image");
      return post("image", input);
    },
    scanAudio(input) {
      validateContext(input);
      validateEncodedMedia(input.audio, "audio");
      return post("audio", input);
    },
    scanVideo(input) {
      validateContext(input);
      if (!Array.isArray(input.frames) || input.frames.length === 0) {
        throw new TypeError("At least one sampled video frame is required");
      }
      if (input.frames.length > 6) {
        throw new TypeError("A maximum of 6 sampled video frames is supported");
      }
      for (const frame of input.frames) validateEncodedMedia(frame, "image");
      if (input.audio) validateEncodedMedia(input.audio, "audio");
      if (input.transcript && input.transcript.length > 20_000) {
        throw new TypeError(
          "video transcript must not exceed 20000 characters",
        );
      }
      return post("video", input);
    },
  };
}

function validateContext(input: ChildSafetyMediaContext): void {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.eventId)) {
    throw new TypeError("eventId must be 8-160 URL-safe characters");
  }
  if (
    input.riskSessionId !== undefined &&
    !/^[A-Za-z0-9._:-]{8,160}$/.test(input.riskSessionId)
  ) {
    throw new TypeError("riskSessionId must be 8-160 URL-safe characters");
  }
}

function validateEncodedMedia(
  media: ChildSafetyEncodedMedia,
  kind: "image" | "audio",
): void {
  if (!media || typeof media.base64 !== "string" || !media.base64.trim()) {
    throw new TypeError(`${kind} base64 is required`);
  }
  if (typeof media.mimeType !== "string" || !media.mimeType.trim()) {
    throw new TypeError(`${kind} mimeType is required`);
  }
}

function validateMediaResult(
  value: unknown,
  expectedKind: "image" | "audio" | "video",
): ChildSafetyMediaScanResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid XGuard child-safety media response");
  }
  const result = value as Partial<ChildSafetyMediaScanResult>;
  if (
    typeof result.eventId !== "string" ||
    typeof result.riskLevel !== "string" ||
    typeof result.primaryAction !== "string" ||
    !result.enforcement ||
    !result.mediaScan ||
    result.mediaScan.kind !== expectedKind ||
    result.mediaScan.rawMediaStored !== false
  ) {
    throw new TypeError("Invalid XGuard child-safety media response contract");
  }
  return result as ChildSafetyMediaScanResult;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TypeError("XGuard URL must be a valid absolute URL");
  }
  const localhost =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localhost) {
    throw new TypeError(
      "XGuard URL must use HTTPS, except for localhost development",
    );
  }
  if (url.username || url.password) {
    throw new TypeError("XGuard URL must not contain embedded credentials");
  }
  return url.origin;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return 15_000;
  if (!Number.isSafeInteger(value) || value < 500 || value > 60_000) {
    throw new TypeError("timeoutMs must be an integer between 500 and 60000");
  }
  return value;
}
