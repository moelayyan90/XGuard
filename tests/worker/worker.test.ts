import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettleResponse } from "@x402/core/types";
import { fixturePayment, PAYER } from "../fixtures.js";
import worker from "../../apps/worker/src/index.js";

const measuredCapabilities = {
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: "eip155:84532",
      extra: {
        assetTransferMethod: "eip3009",
        paymentFlow: "authorization",
      },
    },
  ],
  extensions: ["payment-identifier"],
  signers: {
    eip155: ["0x4444444444444444444444444444444444444444"],
  },
};

afterEach(() => vi.unstubAllGlobals());

function prepareInput(key: string) {
  return {
    logicalPaymentKey: key,
    requestFingerprint: `fingerprint-${key}`,
    paymentIdentifier: `payment-${key}`,
    network: "eip155:84532",
    testnet: true,
  };
}

describe("Cloudflare payment coordinator", () => {
  it("advertises only measured capabilities and readiness", async () => {
    const root = await exports.default.fetch("https://xguard.test/");
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({
      name: "XGuard",
      mode: "testnet-only",
      protocol: "x402-v2",
    });

    const ready = await exports.default.fetch("https://xguard.test/readyz");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      status: "not_ready",
      mainnet: false,
    });
    const before = await exports.default.fetch("https://xguard.test/supported");
    expect(await before.json()).toMatchObject({ kinds: [] });

    await env.DB.prepare(
      `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,latency_ms,capabilities_json,checked_at)
       VALUES('x402-org-testnet','HEALTHY',0,10,?,?)
       ON CONFLICT(facilitator_id) DO UPDATE SET state='HEALTHY',consecutive_failures=0,latency_ms=10,capabilities_json=excluded.capabilities_json,checked_at=excluded.checked_at`,
    )
      .bind(JSON.stringify(measuredCapabilities), new Date().toISOString())
      .run();
    const measuredReady = await exports.default.fetch(
      "https://xguard.test/readyz",
    );
    expect(measuredReady.status).toBe(200);
    const supported = await exports.default.fetch(
      "https://xguard.test/supported",
    );
    expect(await supported.json()).toMatchObject({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    });

    await env.DB.prepare(
      "UPDATE facilitator_health SET checked_at=? WHERE facilitator_id='x402-org-testnet'",
    )
      .bind(new Date(Date.now() - 901_000).toISOString())
      .run();
    const staleReady = await exports.default.fetch(
      "https://xguard.test/readyz",
    );
    expect(staleReady.status).toBe(503);
    const staleSupported = await exports.default.fetch(
      "https://xguard.test/supported",
    );
    expect(await staleSupported.json()).toMatchObject({ kinds: [] });
  });

  it("measures valid capabilities and quarantines malformed capability responses", async () => {
    const officialMixedCapabilities = {
      kinds: [
        { x402Version: 1, scheme: "exact", network: "base-sepolia" },
        {
          x402Version: 2,
          scheme: "exact",
          network: "eip155:84532",
        },
      ],
      extensions: ["payment-identifier"],
      signers: {
        eip155: ["0x4444444444444444444444444444444444444444"],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(officialMixedCapabilities), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const healthyContext = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, healthyContext);
    await waitOnExecutionContext(healthyContext);
    expect(
      await env.DB.prepare(
        "SELECT state,capabilities_json FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
      ).first(),
    ).toMatchObject({ state: "HEALTHY" });
    const normalized = await env.DB.prepare(
      "SELECT capabilities_json FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
    ).first<{ capabilities_json: string }>();
    expect(
      (
        JSON.parse(normalized?.capabilities_json ?? "{}") as {
          kinds: Array<{ extra?: Record<string, unknown> }>;
        }
      ).kinds.map((kind) => kind.extra?.assetTransferMethod),
    ).toEqual(["eip3009", "permit2"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(40_000));
                controller.enqueue(new Uint8Array(40_000));
                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const oversizedContext = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, oversizedContext);
    await waitOnExecutionContext(oversizedContext);
    expect(
      await env.DB.prepare(
        "SELECT state FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
      ).first(),
    ).toMatchObject({ state: "QUARANTINED" });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"kinds":[],"kinds":[],"extensions":[],"signers":{}}', {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const malformedContext = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, malformedContext);
    await waitOnExecutionContext(malformedContext);
    expect(
      await env.DB.prepare(
        "SELECT state FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
      ).first(),
    ).toMatchObject({ state: "QUARANTINED" });
  });

  it("never follows facilitator redirects during capability checks", async () => {
    await env.DB.prepare(
      "DELETE FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
    ).run();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { Location: "https://redirected.example/supported" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, context);
    await waitOnExecutionContext(context);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT state,last_error_code FROM facilitator_health WHERE facilitator_id='x402-org-testnet'",
      ).first(),
    ).toMatchObject({ state: "DEGRADED", last_error_code: "Error" });
  });

  it("serializes strict JSON settlement results before Durable Object RPC", async () => {
    await env.DB.prepare(
      `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,latency_ms,capabilities_json,checked_at)
       VALUES('x402-org-testnet','HEALTHY',0,10,?,?)
       ON CONFLICT(facilitator_id) DO UPDATE SET state='HEALTHY',consecutive_failures=0,latency_ms=10,capabilities_json=excluded.capabilities_json,checked_at=excluded.checked_at`,
    )
      .bind(JSON.stringify(measuredCapabilities), new Date().toISOString())
      .run();
    const { payload, requirements } = fixturePayment({
      nonce: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
      paymentId: null,
    });
    const transaction = `0x${"cd".repeat(32)}`;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(
          JSON.stringify({
            success: true,
            transaction,
            network: requirements.network,
            payer: PAYER,
            amount: requirements.amount,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": `test-client-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    } satisfies RequestInit;

    const settled = await exports.default.fetch(
      "https://xguard.test/settle",
      request,
    );
    expect(settled.status).toBe(200);
    expect(await settled.json()).toMatchObject({ success: true, transaction });
    expect(settled.headers.get("X-XGuard-Replayed")).toBe("false");

    const replayed = await exports.default.fetch(
      "https://xguard.test/settle",
      request,
    );
    expect(replayed.status).toBe(200);
    expect(replayed.headers.get("X-XGuard-Replayed")).toBe("true");
    expect(await replayed.json()).toMatchObject({ success: true, transaction });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("grants one outbound owner across 1,000 simultaneous duplicates", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const stub = env.PAYMENT_COORDINATOR.getByName(key);
    const results = await Promise.all(
      Array.from({ length: 1_000 }, () => stub.prepare(prepareInput(key))),
    );
    expect(results.filter((result) => result.kind === "OWNER")).toHaveLength(1);
    expect(
      results.filter((result) => result.kind === "IN_PROGRESS"),
    ).toHaveLength(999);
    expect(await stub.start("mock-testnet")).toBe(true);
    expect(await stub.start("second-facilitator")).toBe(false);
  });

  it("enforces per-client concurrency leases and releases them", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const gate = env.REQUEST_GATE.getByName(key);
    const leases = Array.from({ length: 5 }, () => crypto.randomUUID());
    const acquired = await Promise.all(
      leases.map((lease) => gate.acquire(lease, Date.now(), 60_000, 4)),
    );
    expect(acquired.filter(Boolean)).toHaveLength(4);
    const rejectedIndex = acquired.findIndex((value) => !value);
    expect(rejectedIndex).toBeGreaterThanOrEqual(0);
    const heldLease = leases.find((_, index) => acquired[index]);
    expect(heldLease).toBeDefined();
    await gate.release(heldLease ?? "");
    expect(
      await gate.acquire(
        leases[rejectedIndex] ?? "replacement",
        Date.now(),
        60_000,
        4,
      ),
    ).toBe(true);
  });

  it("rate limits anonymous testnet facilitator traffic before routing", async () => {
    const client = `Bearer test-client-${crypto.randomUUID()}`;
    let response = new Response();
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await exports.default.fetch("https://xguard.test/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: client,
        },
        body: "{}",
      });
    }
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("rejects malformed, oversized, and mainnet requests before routing", async () => {
    const duplicate = await exports.default.fetch(
      "https://xguard.test/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"x402Version":2,"x402Version":2,"paymentPayload":{},"paymentRequirements":{}}',
      },
    );
    const oversized = await exports.default.fetch(
      "https://xguard.test/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "a".repeat(70_000) }),
      },
    );
    const oversizedDeclaration = await exports.default.fetch(
      "https://xguard.test/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "65537",
          "CF-Connecting-IP": "198.51.100.42",
        },
        body: "{}",
      },
    );
    const { payload, requirements } = fixturePayment({
      network: "eip155:8453",
    });
    const mainnet = await exports.default.fetch("https://xguard.test/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    });
    expect(duplicate.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(oversizedDeclaration.status).toBe(413);
    expect(mainnet.status).toBe(503);
    expect(await mainnet.json()).toMatchObject({
      success: false,
      errorReason: "unsupported",
    });
  });

  it("selects a compatible route before claiming financial identity", async () => {
    await env.DB.prepare(
      `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,latency_ms,capabilities_json,checked_at)
       VALUES('x402-org-testnet','HEALTHY',0,10,?,?)
       ON CONFLICT(facilitator_id) DO UPDATE SET state='HEALTHY',consecutive_failures=0,latency_ms=10,capabilities_json=excluded.capabilities_json,checked_at=excluded.checked_at`,
    )
      .bind(JSON.stringify(measuredCapabilities), new Date().toISOString())
      .run();
    const { payload, requirements } = fixturePayment({
      paymentId: `pay_${crypto.randomUUID().replaceAll("-", "")}`,
    });
    payload.extensions = {
      ...payload.extensions,
      bazaar: { info: { discoverable: true } },
    };
    const response = await exports.default.fetch("https://xguard.test/settle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": `test-client-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      errorReason: "xguard_no_healthy_route",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM payment_identifiers",
      ).first<{ count: number }>(),
    ).toMatchObject({ count: 0 });
  });

  it("persists a testnet settlement projection but creates no billable event", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const stub = env.PAYMENT_COORDINATOR.getByName(key);
    expect((await stub.prepare(prepareInput(key))).kind).toBe("OWNER");
    expect(await stub.start("mock-testnet")).toBe(true);
    const settled: SettleResponse = {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
      amount: "1000",
    };
    await stub.finalize(settled, 2_000, 0);
    await runDurableObjectAlarm(stub);

    const projection = await env.DB.prepare(
      "SELECT state,testnet,fee_micro_usd FROM settlement_projection WHERE logical_payment_key=?",
    )
      .bind(key)
      .first();
    const billed = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_events WHERE logical_payment_key=?",
    )
      .bind(key)
      .first<{ count: number }>();
    expect(projection).toMatchObject({
      state: "SETTLED",
      testnet: 1,
      fee_micro_usd: 0,
    });
    expect(billed?.count).toBe(0);

    const replay = await stub.prepare(prepareInput(key));
    expect(replay.kind).toBe("CACHED");
  });

  it("quarantines uncertainty and opens reconciliation without billing", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const stub = env.PAYMENT_COORDINATOR.getByName(key);
    await stub.prepare(prepareInput(key));
    await stub.start("mock-timeout");
    await stub.markAmbiguous("network_timeout_after_submit");
    await runDurableObjectAlarm(stub);

    const replay = await stub.prepare(prepareInput(key));
    const reconciliation = await env.DB.prepare(
      "SELECT reason_code,state FROM reconciliation_cases WHERE logical_payment_key=?",
    )
      .bind(key)
      .first();
    const billed = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_events WHERE logical_payment_key=?",
    )
      .bind(key)
      .first<{ count: number }>();
    expect(replay.kind).toBe("AMBIGUOUS");
    expect(reconciliation).toMatchObject({
      reason_code: "network_timeout_after_submit",
      state: "OPEN",
    });
    expect(billed?.count).toBe(0);
  });

  it("recovers a stale started submission as ambiguous without retry", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const stub = env.PAYMENT_COORDINATOR.getByName(key);
    await stub.prepare(prepareInput(key));
    expect(await stub.start("mock-stalled")).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE payment SET updated_at=? WHERE singleton=1",
        new Date(Date.now() - 121_000).toISOString(),
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await stub.prepare(prepareInput(key))).kind).toBe("AMBIGUOUS");
    expect(await stub.start("must-not-retry")).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT state,reason_code FROM reconciliation_cases WHERE logical_payment_key=?",
      )
        .bind(key)
        .first(),
    ).toMatchObject({
      state: "OPEN",
      reason_code: "stale_outbound_started_recovery",
    });
  });

  it("expires stale prepared ownership without submitting or billing", async () => {
    const key = crypto.randomUUID().replaceAll("-", "");
    const stub = env.PAYMENT_COORDINATOR.getByName(key);
    expect((await stub.prepare(prepareInput(key))).kind).toBe("OWNER");
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE payment SET updated_at=? WHERE singleton=1",
        new Date(Date.now() - 121_000).toISOString(),
      );
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.prepare(prepareInput(key))).toMatchObject({
      kind: "FAILED",
      result: {
        success: false,
        errorReason: "xguard_prepared_expired",
      },
    });
    expect(await stub.start("must-not-submit")).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT state,fee_micro_usd FROM settlement_projection WHERE logical_payment_key=?",
      )
        .bind(key)
        .first(),
    ).toMatchObject({ state: "FAILED", fee_micro_usd: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM usage_events WHERE logical_payment_key=?",
      )
        .bind(key)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });
  });
});
