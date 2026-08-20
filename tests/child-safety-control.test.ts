import { describe, expect, it } from "vitest";
import { childSafetyControlResponse } from "../apps/worker/src/child-safety-control.js";

const env = {
  DB: {} as D1Database,
  AI: { run: async () => ({}) },
};

describe("child safety control layer", () => {
  it("serves a server-side dashboard login without exposing an API key", async () => {
    const response = await childSafetyControlResponse(
      new Request("https://xguardgate.com/child-safety/dashboard"),
      env,
    );
    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain("Merchant API key");
    expect(html).toContain("HttpOnly dashboard session");
    expect(response?.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("requires authentication for dashboard metrics", async () => {
    const response = await childSafetyControlResponse(
      new Request("https://xguardgate.com/v1/child-safety/dashboard/summary"),
      env,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "unauthorized" });
  });
});
