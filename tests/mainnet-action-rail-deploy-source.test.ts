import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mainnet Universal Action Rail deployment contract", () => {
  it("requires the live action discovery surface or an explicit emergency shutdown", async () => {
    const source = await readFile(
      ".github/workflows/deploy-mainnet.yml",
      "utf8",
    );

    if (source.includes("intentionally disabled")) {
      expect(source).toContain("workflow_dispatch");
      expect(source).toContain("if: ${{ false }}");
      return;
    }

    expect(source).toContain("statuses: write");
    expect(source).toContain("/.well-known/xguard/actions.json");
    expect(source).toContain("XGuard Universal Action Rail");
    expect(source).toContain("universal-action-gateway");
    expect(source).toContain("/v1/actions/execute");
    expect(source).toContain("prepaid-per-successful-upstream-action");
    expect(source).toContain('skill.id==="universal-actions"');
    expect(source).toContain("xguard-mainnet-live");
    expect(source).toContain("XGuard Universal Action Rail is live on mainnet");
  });
});
