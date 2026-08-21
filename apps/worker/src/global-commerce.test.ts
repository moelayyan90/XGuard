import { describe, expect, it } from "vitest";
import { globalCommerceResponse } from "./global-commerce.js";

describe("global commerce surface", () => {
  it("ignores unrelated routes before touching bindings", async () => {
    const response = await globalCommerceResponse(
      new Request("https://xguardgate.com/healthz"),
      {} as never,
    );
    expect(response).toBeNull();
  });

  it("rejects commerce admin routes without authentication", async () => {
    const response = await globalCommerceResponse(
      new Request("https://xguardgate.com/v1/commerce/opportunities"),
      { XGUARD_ADMIN_TOKEN_SHA256: "0".repeat(64) } as never,
    );
    expect(response?.status).toBe(401);
  });
});
