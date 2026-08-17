import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrypoint = readFileSync("apps/worker/src/universal-mainnet.ts", "utf8");
const resilient = readFileSync(
  "apps/worker/src/resilient-webhook-ingress.ts",
  "utf8",
);
const legacy = readFileSync(
  "apps/worker/src/universal-webhook-ingress.ts",
  "utf8",
);
const config = readFileSync("apps/worker/wrangler.mainnet.jsonc", "utf8");
const migration = readFileSync(
  "apps/worker/migrations/0013_universal_webhook_ingress.sql",
  "utf8",
);

describe("universal webhook production wiring", () => {
  it("routes resilient ingress before legacy route management", () => {
    const resilientIndex = entrypoint.indexOf(
      "const resilientWebhook = await resilientWebhookIngressResponse(",
    );
    const legacyIndex = entrypoint.indexOf(
      "const webhookResponse = await universalWebhookResponse(",
    );
    expect(resilientIndex).toBeGreaterThan(-1);
    expect(legacyIndex).toBeGreaterThan(resilientIndex);
  });

  it("uses durable retries and a per-route limiter", () => {
    expect(resilient).toContain("const MAX_ATTEMPTS = 7;");
    expect(resilient).toContain("RETRY_DELAYS_MS");
    expect(resilient).toContain("WEBHOOK_DELIVERY_QUEUE");
    expect(resilient).toContain("WEBHOOK_RATE_LIMITER");
    expect(resilient).toContain("await this.state.storage.setAlarm(");
    expect(resilient).toContain('redirect: "manual"');
    expect(resilient).toContain("strictPublicHttpsTarget(");
    expect(config).toContain('"WEBHOOK_DELIVERY_QUEUE"');
    expect(config).toContain('"WEBHOOK_RATE_LIMITER"');
  });

  it("preserves route management and evidence tables", () => {
    expect(legacy).toContain('const ROUTES_PATH = "/v1/webhooks/routes";');
    expect(legacy).toContain("rawBodyStored: false");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS universal_webhook_routes",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS universal_webhook_events",
    );
  });
});
