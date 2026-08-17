import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manual deployment script production target", () => {
  it("is hard-locked to xguard-mainnet", async () => {
    const source = await readFile("DEPLOY-XGUARD.ps1", "utf8");

    expect(source).toContain("ConfirmMainnet");
    expect(source).toContain("apps/worker/wrangler.mainnet.jsonc");
    expect(source).toContain("xguard-mainnet");
    expect(source).toContain("src/mainnet-modern.ts");
    expect(source).toContain("npm run smoke:mainnet");
    expect(source).not.toContain("xguard-testnet");
    expect(source).not.toContain("wrangler.local.jsonc");
  });
});
