import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mainnet payment availability gate", () => {
  it("rechecks a degraded or stale facilitator before rejecting a payment", async () => {
    const source = await readFile("apps/worker/src/mainnet.ts", "utf8");
    const start = source.indexOf("async function requireHealthyPayAI");
    const end = source.indexOf("\nfunction assertRuntimeConfig", start);
    const gate = source.slice(start, end);
    const healthyFastPath =
      'if (health !== null && health.state === "HEALTHY") return;';

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(gate).toContain("const health = await currentPayAIHealth(env);");
    expect(gate).toContain(healthyFastPath);
    expect(gate).toContain("await refreshPayAIHealth(env);");
    expect(gate).toContain("const recovered = await currentPayAIHealth(env);");
    expect(gate).toContain('recovered.state !== "HEALTHY"');
  });

  it("keeps last-known capabilities discoverable during a transient degraded state", async () => {
    const source = await readFile("apps/worker/src/mainnet.ts", "utf8");
    const degradedDiscovery = 'if (health === null || health.state === "OPEN")';
    const strictHealthyDiscovery =
      'if (health === null || health.state !== "HEALTHY")';

    expect(source).toContain(degradedDiscovery);
    expect(source).not.toContain(strictHealthyDiscovery);
  });
});
