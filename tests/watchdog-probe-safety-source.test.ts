import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/worker/src/mainnet-watchdog.ts", "utf8");

describe("watchdog synthetic probe safety", () => {
  it("never probes protected write endpoints with a read-only synthetic GET", () => {
    expect(source).not.toContain('path: "/v1/register"');
    expect(source).toContain('path: "/healthz", criticalForWrites: true');
    expect(source).toContain('path: "/readyz", criticalForWrites: true');
  });

  it("does not let discovery-only failures open the global write breaker", () => {
    expect(source).toContain('criticalForWrites: false');
    expect(source).toContain("if (probe.criticalForWrites)");
    expect(source).toContain("highestCriticalFailures >= PROBE_FAILURE_THRESHOLD");
    expect(source).toContain("if (allCriticalHealthy) await closeGlobalProbeBreaker");
  });
});
