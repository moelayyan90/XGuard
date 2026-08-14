import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RoutingEngine,
  SettlementCoordinator,
  SqliteFinancialStore,
} from "@xguard/core";
import { createApp } from "../apps/gateway/src/app.js";
import type { GatewayConfig } from "../apps/gateway/src/config.js";
import { fixturePayment, MockFacilitator } from "./fixtures.js";

let store: SqliteFinancialStore;
let facilitator: MockFacilitator;

async function buildApp(adminToken: string | null = null) {
  store = new SqliteFinancialStore();
  store.createMerchant({
    id: "public-testnet",
    name: "Public",
    apiKeyHash: "unused",
  });
  facilitator = new MockFacilitator();
  const router = new RoutingEngine(
    [
      {
        id: "mock",
        url: "https://mock.invalid",
        client: facilitator,
        downstreamCostMicroUsd: 0n,
      },
    ],
    2_000n,
  );
  const coordinator = new SettlementCoordinator(store, router, {
    mainnetEnabled: false,
    feeMicroUsd: 2_000n,
    supportedNetworks: new Set(["eip155:84532"]),
  });
  await coordinator.initialize();
  const config: GatewayConfig = {
    port: 3402,
    databasePath: ":memory:",
    publicBaseUrl: "https://xguard.test",
    feeMicroUsd: 2_000n,
    mainnetEnabled: false,
    supportedNetworks: new Set(["eip155:84532"]),
    apiKeyPepper: "test-pepper",
    adminToken,
    publicTestnet: true,
    reservePercent: 20,
    minimumReserveMicroUsd: 25_000_000n,
    lowBalanceThresholdMicroUsd: 20_000n,
    facilitatorDefinitions: [],
  };
  return createApp({ config, coordinator, store, router });
}

beforeEach(() => {
  facilitator = new MockFacilitator();
});
afterEach(() => store?.close());

function envelope(options: Parameters<typeof fixturePayment>[0] = {}) {
  const { payload, requirements } = fixturePayment(options);
  return {
    x402Version: 2,
    paymentPayload: payload,
    paymentRequirements: requirements,
  };
}

describe("facilitator-compatible HTTP gateway", () => {
  it("verifies and settles through the exact x402 v2 envelope", async () => {
    const app = await buildApp();
    const body = envelope();
    const verified = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const settled = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ isValid: true });
    expect(settled.status).toBe(200);
    expect(await settled.json()).toMatchObject({
      success: true,
      network: "eip155:84532",
    });
    expect(settled.headers.get("X-XGuard-Replayed")).toBe("false");
    expect(settled.headers.get("X-Request-ID")).toBeTruthy();
  });

  it("returns the cached result and creates one outbound settlement", async () => {
    const app = await buildApp();
    const encoded = JSON.stringify(envelope());
    const first = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encoded,
    });
    const second = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encoded,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("X-XGuard-Replayed")).toBe("true");
    expect(facilitator.settleCalls).toBe(1);
  });

  it("rejects altered payment terms before a second settlement", async () => {
    const app = await buildApp();
    const original = envelope();
    await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(original),
    });
    const altered = structuredClone(original);
    altered.paymentRequirements.amount = "2000";
    const response = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(altered),
    });
    expect(response.status).toBe(409);
    expect(facilitator.settleCalls).toBe(1);
  });

  it("rejects duplicate JSON keys and oversized request bodies", async () => {
    const app = await buildApp();
    const duplicate = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"x402Version":2,"x402Version":2,"paymentPayload":{},"paymentRequirements":{}}',
    });
    const oversized = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "a".repeat(70_000) }),
    });
    const oversizedDeclaration = await app.request("/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "65537",
      },
      body: "{}",
    });
    const oversizedCheckerDeclaration = await app.request("/v1/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "4097",
      },
      body: "{}",
    });
    expect(duplicate.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(oversizedDeclaration.status).toBe(413);
    expect(oversizedCheckerDeclaration.status).toBe(413);
  });

  it("keeps the owner report disabled without an admin secret", async () => {
    const app = await buildApp();
    const response = await app.request("/owner/report");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("serves honest readiness, status, landing, metrics, and payment state", async () => {
    const app = await buildApp();
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/readyz")).status).toBe(200);
    expect(await (await app.request("/status")).json()).toMatchObject({
      gateway: "operational",
      settlement: "operational",
      mode: "testnet-only",
    });
    expect((await app.request("/status/page")).status).toBe(200);
    expect((await app.request("/supported")).status).toBe(200);

    const settled = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope()),
    });
    const key = settled.headers.get("X-XGuard-Payment-Key");
    expect(key).toBeTruthy();
    const state = await app.request(`/v1/payments/${key}`);
    expect(await state.json()).toMatchObject({
      state: "SETTLED",
      testnet: true,
    });
    const metrics = await app.request("/metrics");
    expect(await metrics.text()).toContain("xguard_settlement_success_total 1");
    const balance = await app.request("/v1/balance");
    expect(await balance.json()).toMatchObject({
      availableBalanceUsd: "0.000000",
      lowBalance: false,
      testnetCharged: false,
      autoTopUpAuthorized: false,
    });
  });

  it("authenticates the owner report without leaking secrets", async () => {
    const app = await buildApp("admin-secret");
    expect((await app.request("/owner/report")).status).toBe(401);
    expect(
      (
        await app.request("/owner/report", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    const response = await app.request("/owner/report", {
      headers: { Authorization: "Bearer admin-secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      grossXGuardRevenueUsd: "0.000000",
      ledgerBalanced: true,
      payoutState: "EXTERNAL_BLOCKER",
    });
  });

  it("fails closed on media type, unknown fields, checker input, and request floods", async () => {
    const app = await buildApp();
    const media = await app.request("/verify", {
      method: "POST",
      body: JSON.stringify(envelope()),
    });
    const extra = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...envelope(), unexpected: true }),
    });
    const checker = await app.request("/v1/check", {
      method: "POST",
      body: JSON.stringify({ url: 42 }),
    });
    expect(media.status).toBe(415);
    expect(extra.status).toBe(400);
    expect(checker.status).toBe(400);

    let last = new Response();
    for (let index = 0; index < 117; index += 1)
      last = await app.request("/healthz", {
        headers: { "CF-Connecting-IP": "198.51.100.20" },
      });
    expect(last.status).toBe(200);
    const limited = await app.request("/healthz", {
      headers: { "CF-Connecting-IP": "198.51.100.20" },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
});
