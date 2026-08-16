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

  it("blocks mainnet verification before any downstream service when prepaid balance is insufficient", async () => {
    const source = await readFile(
      "apps/worker/src/mainnet-supervisor.ts",
      "utf8",
    );
    const gate = source.indexOf(
      'if (operation === "/verify" && inspected !== null)',
    );
    const downstream = source.indexOf(
      "const response = await delegateFetch(request, env, ctx);",
      gate,
    );

    expect(gate).toBeGreaterThanOrEqual(0);
    expect(downstream).toBeGreaterThan(gate);
    expect(source.slice(gate, downstream)).toContain(
      "merchantBalance(\n      env.DB,\n      inspected.recovery.merchantId,",
    );
    expect(source.slice(gate, downstream)).toContain(
      'error: "xguard_service_balance_required"',
    );
    expect(source.slice(gate, downstream)).toContain("402");
    expect(source.slice(gate, downstream)).toContain(
      'topUpEndpoint: "/v1/topups/intents"',
    );
  });
});
