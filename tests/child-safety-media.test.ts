import { describe, expect, it, vi } from "vitest";
import { childSafetyMediaResponse } from "../apps/worker/src/child-safety-media.js";

const API_KEY = `xg_live_${"a".repeat(48)}`;

function fakeDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("api_key_hash")) {
                return {
                  merchant_id: "merchant-1",
                  name: "Test merchant",
                  available_balance_micro_usd: 1_000_000,
                  held_balance_micro_usd: 0,
                  active: 1,
                };
              }
              if (sql.includes("SELECT 1 AS found")) return null;
              if (sql.includes("available_balance_micro_usd")) {
                return { available_balance_micro_usd: 1_000_000 };
              }
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function decision(kind: string): Response {
  return new Response(
    JSON.stringify({
      eventId: "event-media-1234",
      contentKind: kind,
      riskLevel: "HIGH",
      categories: ["explicit_sexual_content"],
      primaryAction: "BLOCK",
      enforcement: { blockContent: true, blurMedia: true },
      feeUsd: "0.015",
      rawContentStored: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("child safety media worker", () => {
  it("uses vision for an uploaded image and delegates the derived summary", async () => {
    const aiRun = vi.fn(async () => ({ answer: "Risk-relevant visual summary." }));
    const delegate = vi.fn(async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.contentKind).toBe("image_description");
      expect(String(body.text)).toContain("Risk-relevant visual summary");
      return decision("image_description");
    });
    const request = new Request(
      "https://xguardgate.com/v1/child-safety/media/image",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-media-1234",
          childLikely: true,
          image: { mimeType: "image/png", base64: "aGVsbG8=" },
        }),
      },
    );

    const response = await childSafetyMediaResponse(
      request,
      { DB: fakeDb(), AI: { run: aiRun } },
      delegate,
    );
    const body = (await response?.json()) as Record<string, any>;
    expect(response?.status).toBe(200);
    expect(body.mediaScan.kind).toBe("image");
    expect(body.mediaScan.rawMediaStored).toBe(false);
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/moondream/moondream3.1-9B-A2B",
      expect.objectContaining({ task: "query" }),
    );
  });

  it("transcribes uploaded audio before child-safety classification", async () => {
    const aiRun = vi.fn(async () => ({ text: "temporary transcript" }));
    const delegate = vi.fn(async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.contentKind).toBe("chat_window");
      expect(String(body.text)).toContain("temporary transcript");
      return decision("chat_window");
    });
    const request = new Request(
      "https://xguardgate.com/v1/child-safety/media/audio",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-media-1234",
          audio: { mimeType: "audio/mpeg", base64: "aGVsbG8=" },
        }),
      },
    );

    const response = await childSafetyMediaResponse(
      request,
      { DB: fakeDb(), AI: { run: aiRun } },
      delegate,
    );
    const body = (await response?.json()) as Record<string, any>;
    expect(response?.status).toBe(200);
    expect(body.mediaScan.kind).toBe("audio");
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({ task: "transcribe" }),
    );
  });

  it("combines sampled video frames and audio into one decision", async () => {
    const aiRun = vi.fn(async (model: string) =>
      model.includes("moondream")
        ? { answer: "frame safety summary" }
        : { text: "video audio transcript" },
    );
    const delegate = vi.fn(async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.contentKind).toBe("video_transcript");
      expect(String(body.text)).toContain("Frame 1");
      expect(String(body.text)).toContain("video audio transcript");
      return decision("video_transcript");
    });
    const request = new Request(
      "https://xguardgate.com/v1/child-safety/media/video",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-media-1234",
          frames: [
            {
              mimeType: "image/jpeg",
              base64: "aGVsbG8=",
              timestampMs: 1000,
            },
            {
              mimeType: "image/jpeg",
              base64: "d29ybGQ=",
              timestampMs: 3000,
            },
          ],
          audio: { mimeType: "audio/mpeg", base64: "YXVkaW8=" },
        }),
      },
    );

    const response = await childSafetyMediaResponse(
      request,
      { DB: fakeDb(), AI: { run: aiRun } },
      delegate,
    );
    const body = (await response?.json()) as Record<string, any>;
    expect(response?.status).toBe(200);
    expect(body.mediaScan.kind).toBe("video");
    expect(body.mediaScan.videoFrameCount).toBe(2);
    expect(aiRun).toHaveBeenCalledTimes(3);
  });
});
