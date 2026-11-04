import gateway, { XGuardCredits, type Env } from "./xguard-gateway";
export { XGuardState } from "./xguard-gateway";

interface StageEnv extends Env { STAGING_PROBE_KEY?: string }
const origin = "https://gateway-stage.invalid";
const merchant = "xguard-stage";
const factId = "npm/react/latest-version";
const probePath = "/__xguard_staging_probe";
const hexKey = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
const json = (value: object, status: number) => Response.json(value, { status, headers });

export default {
  async fetch(request: Request, env: StageEnv, ctx: ExecutionContext): Promise<Response> {
    const supplied = request.headers.get("x-xguard-stage-key") ?? "";
    const secret = env.STAGING_PROBE_KEY ?? "";
    if (request.method !== "POST" || new URL(request.url).pathname !== probePath ||
        !hexKey.test(supplied) || !hexKey.test(secret) ||
        !crypto.subtle.timingSafeEqual(enc.encode(supplied), enc.encode(secret))) {
      return new Response(null, { status: 404, headers });
    }
    if (env.PUBLIC_ORIGIN !== origin || env.MERCHANT_ID !== merchant ||
        env.BASE_RPC_URL !== "https://unavailable.invalid") return json({ error: "unsafe_stage_configuration" }, 503);
    try {
      // No caller-controlled target, payment credential, or funded wallet.
      // Staging owns its own Durable Object namespace and HMAC secret.
      const trace = crypto.randomUUID();
      const wallet = ("0x" + crypto.randomUUID().replaceAll("-", "") + "ab".repeat(4)) as `0x${string}`;
      const identity = { wallet, merchant, account: trace };
      const billing = new XGuardCredits(ctx, env);
      const read = (id: string, auth?: string, signature?: string) => gateway.fetch(
        new Request(origin + "/fact/" + factId, { headers: {
          "Idempotency-Key": id,
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
          ...(signature ? { "Payment-Signature": signature } : {}),
        } }), env,
      );
      const order = "stage-order-" + trace;
      const unsigned = await read(order);
      if (unsigned.status !== 402 || !unsigned.headers.has("Payment-Required")) {
        return json({ error: "missing_payment_gate", status: unsigned.status }, 502);
      }
      const invalid = await read(order, undefined, "malformed");
      if (invalid.status !== 402) return json({ error: "invalid_proof_admitted", status: invalid.status }, 502);
      const syntheticGrant = { ...identity, provider: "stripe" as const, paymentId: "fixture-" + trace, amount: 1000 };
      if (await billing.credit(syntheticGrant) !== "credited" || await billing.credit(syntheticGrant) !== "duplicate") {
        return json({ error: "synthetic_grant_invariant" }, 502);
      }
      const token = await billing.issueToken(identity);
      const paid = await read(order, token);
      if (paid.status !== 200 || paid.headers.get("X-XGuard-Billing-Rail") !== "credits" ||
          paid.headers.get("X-XGuard-Replayed") !== "0" || paid.headers.has("Payment-Response")) {
        return json({ error: "origin_or_credit_commit_failed", status: paid.status }, 502);
      }
      const body = await paid.text();
      const payload = JSON.parse(body) as { fact?: { id?: string; current_value?: unknown } };
      if (payload.fact?.id !== factId || payload.fact.current_value == null) {
        return json({ error: "unexpected_origin_fact_shape" }, 502);
      }
      const replay = await read(order, token);
      if (replay.status !== 200 || replay.headers.get("X-XGuard-Replayed") !== "1" || await replay.text() !== body) {
        return json({ error: "replay_invariant" }, 502);
      }
      const exhausted = await read(order + "-new", token);
      if (exhausted.status !== 402) return json({ error: "double_debit_invariant", status: exhausted.status }, 502);
      return json({ ok: true, origin_fact: true, unpaid: 402, invalid: 402,
        synthetic_credit_read: 200, replay: 200, exhausted: 402, real_transfers: 0 }, 200);
    } catch {
      return json({ error: "staging_probe_failed" }, 502);
    }
  },
} satisfies ExportedHandler<StageEnv>;
