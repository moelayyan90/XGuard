import { describe, expect, it, vi } from "vitest";
import { createChildSafetyMediaClient } from "../packages/sdk/src/child-safety-media.js";

const API_KEY = `xg_live_${"a".repeat(48)}`;

function mediaResult(kind: "image" | "audio" | "video") {
  return {
    eventId: "event-media-1234",
    contentKind:
      kind === "image"
        ? "image_description"
        : kind === "video"
          ? "video_transcript"
          : "chat_window",
    riskLevel: "HIGH",
    categories: ["explicit_sexual_content"],
    primaryAction: "BLOCK",
    enforcement: { blockContent: true, blurMedia: true },
    feeUsd: kind === "video" ? "0.020" : kind === "image" ? "0.015" : "0.010",
    rawContentStored: false,
    mediaScan: {
      kind,
      rawMediaStored: false,
      preprocessing:
        kind === "image"
          ? "vision"
          : kind === "audio"
            ? "speech_to_text"
            : "sampled_frames_plus_audio",
    },
  };
}

describe("child safety media SDK", () => {
  it("posts image scans to the media endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mediaResult("image")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createChildSafetyMediaClient({
      url: "https://xguardgate.com",
      apiKey: API_KEY,
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.scanImage({
      eventId: "event-media-1234",
      image: { mimeType: "image/png", base64: "aGVsbG8=" },
    });

    expect(result.mediaScan.kind).toBe("image");
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/child-safety/media/image");
  });

  it("posts audio scans to the media endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mediaResult("audio")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createChildSafetyMediaClient({
      url: "https://xguardgate.com",
      apiKey: API_KEY,
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.scanAudio({
      eventId: "event-media-1234",
      audio: { mimeType: "audio/mpeg", base64: "YXVkaW8=" },
    });

    expect(result.mediaScan.kind).toBe("audio");
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/v1/child-safety/media/audio");
  });

  it("requires sampled frames for video scans", () => {
    const client = createChildSafetyMediaClient({
      url: "https://xguardgate.com",
      apiKey: API_KEY,
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(() =>
      client.scanVideo({ eventId: "event-media-1234", frames: [] }),
    ).toThrow("At least one sampled video frame is required");
  });
});
