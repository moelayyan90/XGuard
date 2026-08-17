import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("apps/worker/wrangler.watchdog.jsonc", "utf8");
const source = readFileSync("apps/worker/src/mainnet-watchdog.ts", "utf8");

describe("watchdog mainnet service binding probes", () => {
  it("binds the watchdog directly to xguard-mainnet", () => {
    expect(config).toContain('"binding": "MAINNET_SERVICE"');
    expect(config).toContain('"service": "xguard-mainnet"');
  });

  it("uses the internal service binding before the public fallback", () => {
    expect(source).toContain("MAINNET_SERVICE?: ServiceFetcher");
    expect(source).toContain("env.MAINNET_SERVICE.fetch(request)");
    expect(source).toContain(": await fetch(request)");
  });

  it("keeps health and readiness as the only critical write-safety probes", () => {
    expect(source).toContain('{ key: "healthz", path: "/healthz", criticalForWrites: true }');
    expect(source).toContain('{ key: "readyz", path: "/readyz", criticalForWrites: true }');
    expect(source).toContain('key: "x402-discovery"');
    expect(source).toContain('key: "mcp-discovery"');
    expect(source).toContain("criticalForWrites: false");
  });
});
