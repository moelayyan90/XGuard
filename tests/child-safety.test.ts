import { describe, expect, it, vi } from "vitest";
import { childSafetyResponse } from "../apps/worker/src/child-safety.js";

function env() {
  return {
    DB: {} as D1Database,
    AI: { run: vi.fn() },
  };
}

describe("XGuard child safety control layer", () => {
  it("serves the child safety product at root", async () => {
    const response = await childSafetyResponse(
      new Request("https://xguardgate.com/"),
      env(),
    );

    expect(response?.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain("Child Safety Control Layer");
    expect(html).toContain("FREEZE CHAT");
    expect(html).toContain("$0.005");
  });

  it("publishes per-event B2B pricing", async () => {
    const response = await childSafetyResponse(
      new Request("https://xguardgate.com/v1/child-safety/catalog"),
      env(),
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      billingModel: string;
      pricing: Array<{ contentKind: string; usd: string; microUsd: number }>;
      actions: string[];
    };
    expect(body.billingModel).toBe("per analyzed safety event");
    expect(body.pricing).toContainEqual({
      contentKind: "message",
      usd: "0.005",
      microUsd: 5000,
    });
    expect(body.actions).toContain("FREEZE_CHAT");
  });

  it("routes Jordan to a verified child helpline and global reporting networks", async () => {
    const response = await childSafetyResponse(
      new Request(
        "https://xguardgate.com/v1/child-safety/reporting?country=Jordan",
      ),
      env(),
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      local: { childHelpline: string };
      global: Array<{ name: string; url: string }>;
    };
    expect(body.local.childHelpline).toBe("110");
    expect(body.global.some((item) => item.name === "INHOPE")).toBe(true);
    expect(body.global.some((item) => item.name === "NCMEC CyberTipline")).toBe(
      true,
    );
  });

  it("does not invent a local number when a country pack is missing", async () => {
    const response = await childSafetyResponse(
      new Request(
        "https://xguardgate.com/v1/child-safety/reporting?country=Unknownland",
      ),
      env(),
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      local: unknown;
      coverageNote: string;
    };
    expect(body.local).toBeNull();
    expect(body.coverageNote).toContain("official country selectors");
  });

  it("requires a paying merchant context before scanning content", async () => {
    const response = await childSafetyResponse(
      new Request("https://xguardgate.com/v1/child-safety/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "event-12345678",
          contentKind: "message",
          childLikely: true,
          text: "test message",
        }),
      }),
      env(),
    );

    expect(response?.status).toBe(401);
  });
});
