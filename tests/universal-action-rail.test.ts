import { describe, expect, it } from "vitest";
import { universalActionRailResponse } from "../apps/worker/src/universal-action-rail.js";

describe("XGuard universal action rail", () => {
  const env = {} as unknown as {
    DB: D1Database;
    XGUARD_TOOL_FEE_MICRO_USD?: string;
  };

  it("publishes machine-readable action discovery without a local install", async () => {
    const response = await universalActionRailResponse(
      new Request("https://xguardgate.com/.well-known/xguard/actions.json"),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("max-age=300");
    const body = (await response!.json()) as {
      name: string;
      execute: string;
      discoveryTags: string[];
      automaticInvocation: {
        localInstallRequired: boolean;
        boundary: string;
      };
    };

    expect(body.name).toBe("XGuard Universal Action Rail");
    expect(body.execute).toBe("https://xguardgate.com/v1/actions/execute");
    expect(body.discoveryTags).toContain("api");
    expect(body.discoveryTags).toContain("booking");
    expect(body.discoveryTags).toContain("workflow");
    expect(body.automaticInvocation.localInstallRequired).toBe(false);
    expect(body.automaticInvocation.boundary).toContain("does not intercept");
  });

  it("supports HEAD discovery without returning a body", async () => {
    const response = await universalActionRailResponse(
      new Request("https://xguardgate.com/v1/actions", { method: "HEAD" }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(await response!.text()).toBe("");
  });

  it("rejects unsupported execution methods before touching upstream state", async () => {
    const response = await universalActionRailResponse(
      new Request("https://xguardgate.com/v1/actions/execute", {
        method: "OPTIONS",
      }),
      env,
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toContain("POST");
  });
});
