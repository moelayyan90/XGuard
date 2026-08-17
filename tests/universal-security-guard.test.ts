import { describe, expect, it } from "vitest";
import {
  strictPublicHttpsTarget,
  universalSecurityGuardResponse,
} from "../apps/worker/src/universal-security-guard.js";

describe("universal security guard", () => {
  it("accepts normal public HTTPS targets", () => {
    expect(strictPublicHttpsTarget("https://api.example.com/v1/data")?.hostname).toBe(
      "api.example.com",
    );
  });

  it("blocks local, literal-IP and XGuard self targets", () => {
    for (const target of [
      "http://api.example.com/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://metadata.google.internal/v1",
      "https://xguardgate.com/status",
      "https://xguard-mainnet.maqamapp.workers.dev/status",
    ])
      expect(strictPublicHttpsTarget(target)).toBeNull();
  });

  it("fails unsafe generic HTTP targets before connector execution", async () => {
    const request = new Request("https://xguardgate.com/v1/gateway/http", {
      headers: { "x-xguard-upstream-url": "https://127.0.0.1/private" },
    });
    const response = universalSecurityGuardResponse(request);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({
      error: "unsafe_or_invalid_upstream_url",
    });
  });
});
