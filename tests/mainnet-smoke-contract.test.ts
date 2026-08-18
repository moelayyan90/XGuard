import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mainnet smoke contract", () => {
  it("uses runtime health for mainnet identity and verifies the Universal Action Rail", () => {
    const source = readFileSync("scripts/smoke-mainnet.mjs", "utf8");

    expect(source).toContain('const health = await json("/healthz")');
    expect(source).toContain('const status = await json("/status")');
    expect(source).toContain(
      'const actions = await json("/.well-known/xguard/actions.json")',
    );
    expect(source).toContain(
      'actions.body.name === "XGuard Universal Action Rail"',
    );
    expect(source).toContain(
      'actions.body.category === "universal-action-gateway"',
    );
    expect(source).toContain("universalActionRail: true");

    expect(source).not.toContain('root.body.mode === "mainnet"');
    expect(source).not.toContain('root.body.network === BASE_MAINNET');
    expect(source).not.toContain('root.body.asset === BASE_USDC');
  });
});
