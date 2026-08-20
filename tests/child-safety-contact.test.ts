import { describe, expect, it } from "vitest";
import { childSafetyContactResponse } from "../apps/worker/src/child-safety-contact.js";

interface CapturedDb {
  binds: unknown[][];
}

function makeEnv(captured: CapturedDb) {
  const DB = {
    prepare() {
      return {
        bind(...values: unknown[]) {
          captured.binds.push(values);
          return {
            async run() {
              return { success: true };
            },
          };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  } as unknown as D1Database;

  const REQUEST_RATE_LIMITER = {
    async limit() {
      return { success: true };
    },
  } as unknown as RateLimit;

  return {
    DB,
    REQUEST_RATE_LIMITER,
    XGUARD_ADMIN_TOKEN_SHA256:
      "4e9ebd63eea15efdeb2926107384937c1fe843d8eeb0bed4180f214d307a239f",
  };
}

describe("XGuard institutional child-safety contact", () => {
  it("serves an institutional-only contact form with a safeguarding boundary", async () => {
    const response = await childSafetyContactResponse(
      new Request("https://xguardgate.com/child-safety/contact"),
      makeEnv({ binds: [] }),
    );

    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain("Institutional contact");
    expect(html).toContain("Do not send names, images, conversations");
    expect(html).toContain(
      "Do not upload or transmit suspected child sexual abuse material",
    );
  });

  it("accepts a valid institutional enquiry and stores only a hashed source identifier", async () => {
    const captured: CapturedDb = { binds: [] };
    const response = await childSafetyContactResponse(
      new Request("https://xguardgate.com/v1/child-safety/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: JSON.stringify({
          organization: "Example Ministry",
          roleTitle: "Online Safety Lead",
          country: "Exampleland",
          email: "safety@example.gov",
          website: "https://example.gov",
          inquiryType: "government",
          message:
            "We would like to discuss a limited child-safety pilot with XGuard.",
        }),
      }),
      makeEnv(captured),
    );

    expect(response?.status).toBe(201);
    expect(captured.binds).toHaveLength(1);
    const values = captured.binds[0] ?? [];
    expect(values).not.toContain("203.0.113.9");
    expect(values[1]).toBe("Example Ministry");
    expect(values[4]).toBe("safety@example.gov");
    expect(typeof values[8]).toBe("string");
    expect((values[8] as string).length).toBe(64);
  });

  it("rejects malformed institutional contact email", async () => {
    const response = await childSafetyContactResponse(
      new Request("https://xguardgate.com/v1/child-safety/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization: "Example Platform",
          email: "not-an-email",
          inquiryType: "platform",
          message:
            "We would like to discuss integrating XGuard into our platform.",
        }),
      }),
      makeEnv({ binds: [] }),
    );

    expect(response?.status).toBe(400);
  });

  it("does not expose the institutional contact ledger without admin authentication", async () => {
    const response = await childSafetyContactResponse(
      new Request("https://xguardgate.com/v1/child-safety/contact"),
      makeEnv({ binds: [] }),
    );

    expect(response?.status).toBe(401);
  });

  it("ignores unrelated routes", async () => {
    expect(
      await childSafetyContactResponse(
        new Request("https://xguardgate.com/healthz"),
        makeEnv({ binds: [] }),
      ),
    ).toBeNull();
  });
});
