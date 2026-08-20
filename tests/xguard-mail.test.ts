import { describe, expect, it } from "vitest";
import { xguardMailHttpResponse } from "../apps/worker/src/xguard-mail.js";

const env = {
  DB: {} as D1Database,
  XGUARD_ADMIN_TOKEN_SHA256:
    "4e9ebd63eea15efdeb2926107384937c1fe843d8eeb0bed4180f214d307a239f",
};

describe("XGuard branded mail", () => {
  it("publishes the info and support addresses without personal forwarding", async () => {
    const response = await xguardMailHttpResponse(
      new Request("https://xguardgate.com/v1/mail/status"),
      env,
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      addresses: { info: string; support: string };
      personalEmailForwarding: boolean;
    };
    expect(body.addresses.info).toBe("info@xguardgate.com");
    expect(body.addresses.support).toBe("support@xguardgate.com");
    expect(body.personalEmailForwarding).toBe(false);
  });

  it("does not allow outbound mail without administrator authentication", async () => {
    const response = await xguardMailHttpResponse(
      new Request("https://xguardgate.com/v1/mail/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailbox: "info",
          to: "agency@example.gov",
          subject: "XGuard",
          text: "Hello",
        }),
      }),
      env,
    );
    expect(response?.status).toBe(401);
  });

  it("ignores unrelated routes", async () => {
    expect(
      await xguardMailHttpResponse(
        new Request("https://xguardgate.com/healthz"),
        env,
      ),
    ).toBeNull();
  });
});
