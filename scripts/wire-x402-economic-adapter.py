from pathlib import Path

worker = Path("apps/worker/src/economic-firewall.ts")
s = worker.read_text()

import_anchor = '''import {
  EconomicIntentCoordinator,
  type EconomicIntentSnapshot,
} from "./economic-intent-coordinator.js";
'''
adapter_import = '''import {
  EconomicIntentCoordinator,
  type EconomicIntentSnapshot,
} from "./economic-intent-coordinator.js";
import {
  parseEconomicX402Envelope,
  settleEconomicX402,
  verifyEconomicX402,
} from "./x402-economic-adapter.js";
'''
if import_anchor not in s:
    raise SystemExit("import anchor not found")
s = s.replace(import_anchor, adapter_import, 1)

env_anchor = '''  GLOBAL_RATE_LIMITER: RateLimit;
  PREVIEW_API_TOKEN: string;
}'''
env_new = '''  GLOBAL_RATE_LIMITER: RateLimit;
  PREVIEW_API_TOKEN: string;
  X402_FACILITATOR_URL: string;
}'''
if env_anchor not in s:
    raise SystemExit("env anchor not found")
s = s.replace(env_anchor, env_new, 1)

endpoint_anchor = '''      authorize: "POST /v1/intents/:intentId/authorize",
      execute: "POST /v1/intents/:intentId/execute",
      settle: "POST /v1/intents/:intentId/settle",'''
endpoint_new = '''      authorize: "POST /v1/intents/:intentId/authorize",
      x402Authorize: "POST /v1/intents/:intentId/x402/authorize",
      execute: "POST /v1/intents/:intentId/execute",
      settle: "POST /v1/intents/:intentId/settle",
      x402Settle: "POST /v1/intents/:intentId/x402/settle",'''
if endpoint_anchor not in s:
    raise SystemExit("endpoint anchor not found")
s = s.replace(endpoint_anchor, endpoint_new, 1)

route_anchor = 'app.post("/v1/intents/:intentId/authorize", async (context) => {'
x402_authorize = '''app.post("/v1/intents/:intentId/x402/authorize", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    if (snapshot.state !== "BOUND" && snapshot.state !== "AUTHORIZED")
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `x402 authorization cannot run from state ${snapshot.state}`,
        409,
      );
    const raw = await jsonBody(context.req.raw);
    const envelope = parseEconomicX402Envelope(raw, snapshot.terms);
    const verified = await verifyEconomicX402(
      context.env.X402_FACILITATOR_URL,
      envelope,
    );
    if (!verified.isValid)
      return context.json(
        {
          authorized: false,
          invalidReason: verified.invalidReason ?? "x402_invalid_authorization",
          invalidMessage:
            verified.invalidMessage ?? "x402 authorization was rejected",
        },
        402,
      );
    const authorized = await stub.recordAuthorization({
      merchantId,
      authorization: envelope.raw,
      authorizedAmountMicroUsd: envelope.amountMicroUsd,
    });
    return context.json(
      {
        authorized: true,
        payer: envelope.payer,
        payTo: envelope.payTo,
        amountMicroUsd: envelope.amountMicroUsd,
        intent: authorized,
      },
      200,
      {
        "X-XGuard-Intent-ID": authorized.intentId,
        "X-XGuard-State": authorized.state,
        "X-XGuard-Protocol": "x402",
      },
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

'''
if route_anchor not in s:
    raise SystemExit("authorize route anchor not found")
s = s.replace(route_anchor, x402_authorize + route_anchor, 1)

settle_anchor = 'app.post("/v1/intents/:intentId/settle", async (context) => {'
x402_settle = '''app.post("/v1/intents/:intentId/x402/settle", async (context) => {
  try {
    const merchantId = context.get("merchantId");
    const intentId = intentIdParam(context.req.param("intentId"));
    const stub = context.env.ECONOMIC_INTENT_COORDINATOR.getByName(intentId);
    const snapshot = await stub.getSnapshot(merchantId);
    if (snapshot === null)
      throw new XGuardError("BAD_REQUEST", "Intent not found", 404);
    const raw = await jsonBody(context.req.raw);
    const envelope = parseEconomicX402Envelope(raw, snapshot.terms);
    if (snapshot.authorizationHash !== envelope.authorizationHash)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "x402 settlement envelope is not the authorization bound to this Intent",
        409,
      );
    if (snapshot.state === "FINAL")
      return context.json(snapshot, 200, {
        "X-XGuard-Replayed": "true",
        "X-XGuard-Intent-ID": snapshot.intentId,
        "X-XGuard-State": snapshot.state,
        "X-XGuard-Protocol": "x402",
      });
    if (snapshot.state !== "FULFILLED" || snapshot.executionId === null)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        `x402 settlement cannot run from state ${snapshot.state}`,
        409,
      );

    const result = await settleEconomicX402(
      context.env.X402_FACILITATOR_URL,
      envelope,
    );
    if (!result.success)
      return context.json(
        {
          settled: false,
          result,
          intentId: snapshot.intentId,
          state: snapshot.state,
        },
        409,
      );

    await stub.recordSettlement({
      merchantId,
      executionId: snapshot.executionId,
      protocol: "x402",
      settlement: rpcSafeJson(result),
      chargedAmountMicroUsd: envelope.amountMicroUsd,
    });
    const finalized = await stub.getSnapshot(merchantId);
    if (finalized === null)
      throw new XGuardError("INTERNAL_ERROR", "Finalized intent disappeared", 500);
    return context.json(
      { settled: true, result, intent: finalized },
      200,
      {
        "X-XGuard-Replayed": "false",
        "X-XGuard-Intent-ID": finalized.intentId,
        "X-XGuard-State": finalized.state,
        "X-XGuard-Protocol": "x402",
        ...(finalized.proof === null
          ? {}
          : { "X-XGuard-Proof-Hash": finalized.proof.proofHash }),
      },
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

'''
if settle_anchor not in s:
    raise SystemExit("settle route anchor not found")
s = s.replace(settle_anchor, x402_settle + settle_anchor, 1)
worker.write_text(s)

config = Path("apps/worker/wrangler.economic-preview.jsonc")
c = config.read_text()
vars_anchor = '  "workers_dev": true,\n  "minify": true,\n'
vars_new = '  "workers_dev": true,\n  "minify": true,\n  "vars": {\n    "X402_FACILITATOR_URL": "https://xguard-testnet.maqamapp.workers.dev",\n  },\n'
if vars_anchor not in c:
    raise SystemExit("config vars anchor not found")
config.write_text(c.replace(vars_anchor, vars_new, 1))
