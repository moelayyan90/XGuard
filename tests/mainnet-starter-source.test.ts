import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const starterFiles = [
  "examples/x402-xguard-starter/.env.example",
  "examples/x402-xguard-starter/src/server.ts",
  "examples/x402-xguard-starter/src/server-basic.ts",
  "apps/mcp-example/src/server.ts",
] as const;

describe("XGuard example production defaults", () => {
  it("uses xguard-mainnet and Base mainnet by default", async () => {
    const sources = await Promise.all(
      starterFiles.map((path) => readFile(path, "utf8")),
    );
    const combined = sources.join("\n");

    expect(combined).toContain("https://xguard-mainnet.maqamapp.workers.dev");
    expect(combined).toContain("eip155:8453");
    expect(combined).toContain("PAY_TO_MAINNET_ADDRESS");
    expect(combined).toContain("XGUARD_EXAMPLE_PAY_TO");
    expect(combined).not.toContain("xguard-testnet.maqamapp.workers.dev");
    expect(combined).not.toContain("eip155:84532");
    expect(combined).not.toContain("PAY_TO_TESTNET_ADDRESS");
  });

  it("requires explicit merchant credentials before mainnet examples run", async () => {
    const sources = await Promise.all([
      readFile("examples/x402-xguard-starter/src/server.ts", "utf8"),
      readFile("apps/mcp-example/src/server.ts", "utf8"),
    ]);
    const combined = sources.join("\n");

    expect(combined).toContain("XGUARD_API_KEY");
    expect(combined).toContain("PAY_TO_MAINNET_ADDRESS");
    expect(combined).toContain("XGUARD_EXAMPLE_PAY_TO");
    expect(combined).toContain("throw new Error");
  });
});
