import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrypoint = readFileSync("apps/worker/src/universal-mainnet.ts", "utf8");
const legacyIngress = readFileSync(
  "apps/worker/src/universal-webhook-ingress.ts",
  "utf8",
);
const resilientIngress = readFileSync(
  "apps/worker/src/resilient-webhook-ingress.ts",
  "utf8",
);
const mainnetConfig = readFileSync(
  "apps/worker/wrangler.mainnet.jsonc",
  "utf8",
);
const migration = readFileSync(
  "apps/worker/migrations/0013_universal_webhook_ingress.sql",
  "utf8",
);

describe("universal webhook production wiring", () => {
  it("routes resilient webhook ingress before legacy management handling", () => {
    expect(entrypoint).toContain(
      'import { universalWebhookResponse } from "./universal-webhook-ingress.js";',
    );
    expect(entrypoint).toContain(
      'from "./resilient-webhook-ingress.js";',
    );
    const resilientIndex = entrypoint.indexOf(
      "const resilientWebhook = await resilientWebhookIngressResponse(",
    );
    const legacyIndex = entrypoint.indexOf(
      "const webhookResponse = await universalWebhookResponse(",
    );
    const mainnetIndex = entrypoint.indexOf(
      "const response = await mainnetFetch(standardRequest, env, ctx);",
    );
    expect(resilientIndex).toBeGreaterThan(-1);
    expect(legacyIndex).toBeGreaterThan(resilientIndex);
    expect(mainnetIndex).toBeGreaterThan(legacyIndex);
  });

  it("queues webhook delivery with bounded retries and per-route rate limiting", () => {
    expect(resilientIngress).toContain('const INGRESS_PATH = "/v1/webhooks/in/";');
    expect(resilientIngress).toContain("const MAX_ATTEMPTS = 7;");
    expect(resilientIngress).toContain("RETRY_DELAYS_MS");
    expect(resilientIngress).toContain("WEBHOOK_DELIVERY_QUEUE");
    expect(resilientIngress).toContain("WEBHOOK_RATE_LIMITER");
    expect(resilientIngress).toContain("await this.state.storage.setAlarm(");
    expect(resilientIngress).toContain('redirect: "manual"');
    expect(resilientIngress).toContain("strictPublicHttpsTarget(");
    expect(mainnetConfig).toContain('"WEBHOOK_DELIVERY_QUEUE"');
    expect(mainnetConfig).toContain('"WEBHOOK_RATE_LIMITER"');
  });

  it("keeps route management and event evidence separate from delivery queue state", () => {
    expect(legacyIngress).toContain('const ROUTES_PATH = "/v1/webhooks/routes";');
    expect(legacyIngress).toContain("rawBodyStored: false");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS universal_webhook_routes",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS universal_webhook_events",
    );
    expect(migration).toContain("body_sha256 TEXT NOT NULL");
    expect(migration).toContain("signature_evidence_sha256 TEXT");
  });
});
