import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrypoint = readFileSync(
  "apps/worker/src/universal-mainnet.ts",
  "utf8",
);
const ingress = readFileSync(
  "apps/worker/src/universal-webhook-ingress.ts",
  "utf8",
);
const migration = readFileSync(
  "apps/worker/migrations/0013_universal_webhook_ingress.sql",
  "utf8",
);

describe("universal webhook production wiring", () => {
  it("routes webhook traffic at the universal edge before legacy mainnet handling", () => {
    expect(entrypoint).toContain(
      'import { universalWebhookResponse } from "./universal-webhook-ingress.js";',
    );
    const webhookIndex = entrypoint.indexOf(
      "const webhookResponse = await universalWebhookResponse(",
    );
    const legacyIndex = entrypoint.indexOf(
      "return mainnetFetch(standardRequest, env, ctx);",
    );
    expect(webhookIndex).toBeGreaterThan(-1);
    expect(legacyIndex).toBeGreaterThan(webhookIndex);
  });

  it("does not require x402 on webhook ingress", () => {
    expect(ingress).toContain('const INGRESS_PATH = "/v1/webhooks/in/";');
    expect(ingress).toContain("x402Required: false");
    expect(ingress).toContain("rawBodyStored: false");
    expect(ingress).toContain('redirect: "manual"');
    expect(ingress).toContain("safeGenericHttpsTarget(route.destination_url)");
  });

  it("creates immutable event evidence tables separate from x402 settlement tables", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS universal_webhook_routes");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS universal_webhook_events");
    expect(migration).toContain("body_sha256 TEXT NOT NULL");
    expect(migration).toContain("signature_evidence_sha256 TEXT");
  });
});
