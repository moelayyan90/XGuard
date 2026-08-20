import type { ChildSafetyClientOptions } from "./child-safety.js";
import {
  createChildSafetyMediaClient,
  type ChildSafetyEncodedMedia,
  type ChildSafetyMediaContext,
  type ChildSafetyMediaScanResult,
  type ChildSafetyVideoFrame,
} from "./child-safety-media.js";

export interface ChildSafetyBrowserVideoOptions {
  frameCount?: number;
  maxFrameWidth?: number;
  jpegQuality?: number;
  includeAudio?: boolean;
  maxAudioSeconds?: number;
  transcript?: string;
}

export interface ChildSafetyBrowserMediaClient {
  scanImageFile(
    context: ChildSafetyMediaContext,
    image: Blob,
  ): Promise<ChildSafetyMediaScanResult>;
  scanAudioFile(
    context: ChildSafetyMediaContext,
    audio: Blob,
  ): Promise<ChildSafetyMediaScanResult>;
  scanVideoFile(
    context: ChildSafetyMediaContext,
    video: Blob,
    options?: ChildSafetyBrowserVideoOptions,
  ): Promise<ChildSafetyMediaScanResult>;
}

export function createChildSafetyBrowserMediaClient(
  options: ChildSafetyClientOptions,
): ChildSafetyBrowserMediaClient {
  const mediaClient = createChildSafetyMediaClient(options);

  return {
    async scanImageFile(context, image) {
      return mediaClient.scanImage({
        ...context,
        image: await blobToEncodedMedia(image, "image"),
      });
    },

    async scanAudioFile(context, audio) {
      return mediaClient.scanAudio({
        ...context,
        audio: await blobToEncodedMedia(audio, "audio"),
      });
    },

    async scanVideoFile(context, video, rawOptions = {}) {
      assertBrowserRuntime();
      const frameCount = clampInteger(rawOptions.frameCount ?? 6, 1, 6);
      const maxFrameWidth = clampInteger(
        rawOptions.maxFrameWidth ?? 640,
        160,
        1280,
      );
      const jpegQuality = clamp(rawOptions.jpegQuality ?? 0.78, 0.45, 0.95);
      const maxAudioSeconds = clampInteger(
        rawOptions.maxAudioSeconds ?? 180,
        15,
        180,
      );

      const sampled = await sampleVideoFrames(
        video,
        frameCount,
        maxFrameWidth,
        jpegQuality,
      );

      let audio: ChildSafetyEncodedMedia | undefined;
      if (rawOptions.includeAudio !== false) {
        audio = await extractSampledAudio(
          video,
          sampled.duration,
          maxAudioSeconds,
        ).catch(() => undefined);
      }

      return mediaClient.scanVideo({
        ...context,
        frames: sampled.frames,
        ...(audio ? { audio } : {}),
        ...(rawOptions.transcript ? { transcript: rawOptions.transcript } : {}),
      });
    },
  };
}

export function childSafetyVideoSampleTimestamps(
  durationSeconds: number,
  count: number,
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const samples = clampInteger(count, 1, 6);
  const margin = Math.min(0.25, durationSeconds * 0.05);
  const start = Math.min(margin, durationSeconds / 2);
  const end = Math.max(start, durationSeconds - margin);
  if (samples === 1 || end <= start) return [durationSeconds / 2];
  return Array.from({ length: samples }, (_, index) => {
    const ratio = index / (samples - 1);
    return start + (end - start) * ratio;
  });
}

export function childSafetyAudioSampleSegments(
  durationSeconds: number,
  maxTotalSeconds: number,
): Array<{ offset: number; duration: number }> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const cap = Math.max(1, Math.min(durationSeconds, maxTotalSeconds));
  if (durationSeconds <= cap) return [{ offset: 0, duration: durationSeconds }];

  const segmentDuration = cap / 3;
  const middleOffset = Math.max(0, durationSeconds / 2 - segmentDuration / 2);
  const endOffset = Math.max(0, durationSeconds - segmentDuration);
  return [
    { offset: 0, duration: segmentDuration },
    { offset: middleOffset, duration: segmentDuration },
    { offset: endOffset, duration: segmentDuration },
  ];
}

async function sampleVideoFrames(
  videoBlob: Blob,
  frameCount: number,
  maxFrameWidth: number,
  jpegQuality: number,
): Promise<{ frames: ChildSafetyVideoFrame[]; duration: number }> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  const objectUrl = URL.createObjectURL(videoBlob);

  try {
    const metadataReady = once(video, "loadedmetadata");
    video.src = objectUrl;
    video.load();
    await metadataReady;

    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new TypeError("Video duration is unavailable");
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new TypeError("Video dimensions are unavailable");
    }

    const width = Math.min(maxFrameWidth, video.videoWidth);
    const height = Math.max(
      1,
      Math.round((video.videoHeight / video.videoWidth) * width),
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D context is unavailable");

    const timestamps = childSafetyVideoSampleTimestamps(duration, frameCount);
    const frames: ChildSafetyVideoFrame[] = [];
    for (const timestamp of timestamps) {
      await seekVideo(video, timestamp);
      ctx.drawImage(video, 0, 0, width, height);
      const frameBlob = await canvasToBlob(canvas, "image/jpeg", jpegQuality);
      frames.push({
        ...(await blobToEncodedMedia(frameBlob, "image")),
        timestampMs: Math.max(0, Math.round(timestamp * 1000)),
      });
    }
    return { frames, duration };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function extractSampledAudio(
  videoBlob: Blob,
  durationSeconds: number,
  maxAudioSeconds: number,
): Promise<ChildSafetyEncodedMedia> {
  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) throw new Error("AudioContext is unavailable");

  const context = new AudioContextCtor();
  try {
    const bytes = await videoBlob.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const segments = childSafetyAudioSampleSegments(
      Math.min(durationSeconds, decoded.duration),
      maxAudioSeconds,
    );
    if (!segments.length) throw new Error("No audio segment is available");

    const sampleRate = 16_000;
    const totalDuration = segments.reduce(
      (sum, segment) => sum + segment.duration,
      0,
    );
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(totalDuration * sampleRate)),
      sampleRate,
    );

    let cursor = 0;
    for (const segment of segments) {
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(cursor, segment.offset, segment.duration);
      cursor += segment.duration;
    }

    const rendered = await offline.startRendering();
    const wav = encodeMono16BitWav(rendered);
    return blobToEncodedMedia(wav, "audio");
  } finally {
    await context.close().catch(() => undefined);
  }
}

function encodeMono16BitWav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const dataBytes = samples.length * 2;
  const array = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(array);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const sample of samples) {
    const normalized = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      offset,
      normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff,
      true,
    );
    offset += 2;
  }
  return new Blob([array], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function blobToEncodedMedia(
  blob: Blob,
  expected: "image" | "audio",
): Promise<ChildSafetyEncodedMedia> {
  const mimeType = blob.type.trim().toLowerCase();
  if (!mimeType.startsWith(`${expected}/`)) {
    throw new TypeError(`${expected} Blob must include a valid MIME type`);
  }
  const base64 = await arrayBufferToBase64(await blob.arrayBuffer());
  return { base64, mimeType };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(
      offset,
      Math.min(bytes.length, offset + chunk),
    );
    for (const byte of slice) binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2)
    return;
  const ready = once(video, "seeked");
  video.currentTime = Math.max(
    0,
    Math.min(time, Math.max(0, video.duration - 0.001)),
  );
  await ready;
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Media event failed before ${event}`));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
      type,
      quality,
    );
  });
}

function assertBrowserRuntime(): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof URL?.createObjectURL !== "function"
  ) {
    throw new TypeError("Raw video preprocessing requires a browser runtime");
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
