/** Trusted operator forecasts, never client-reported revenue or realized profit. */
export const GOVERNANCE_VERSION = 1;
export const GOVERNANCE_TYPE = "xguard-governance-authorization";
const MAX_MONEY = 10n ** 15n;
const COSTS = ["api", "compute", "payment", "slippage", "safety_buffer"];
export function money(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > MAX_MONEY) throw new Error("invalid_governance_money");
  return BigInt(value);
}
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) throw new Error("invalid_governance_policy");
}
export function validateGovernancePolicy(value, now = Date.now()) {
  // An omitted policy must never create a less restricted external execution path.
  if (value === undefined) throw new Error("governance_policy_required");
  exactKeys(value, ["version", "currency", "minimum_net_usd_micros", "daily_cost_limit_usd_micros", "forecasts"]);
  if (value.version !== 1 || value.currency !== "USD" || !Array.isArray(value.forecasts) || !value.forecasts.length || value.forecasts.length > 32) throw new Error("invalid_governance_policy");
  money(value.minimum_net_usd_micros);
  if (money(value.daily_cost_limit_usd_micros) <= 0n) throw new Error("invalid_governance_daily_limit");
  const seen = new Set();
  for (const forecast of value.forecasts) {
    exactKeys(forecast, ["request_digest", "revenue_if_success_usd_micros", "success_probability_bps", "failure_loss_usd_micros", "valid_until", ...COSTS.map(k => `${k}_cost_usd_micros`)]);
    if (!/^[a-f0-9]{64}$/.test(forecast.request_digest) || seen.has(forecast.request_digest)) throw new Error("invalid_forecast_request_digest");
    seen.add(forecast.request_digest);
    if (!Number.isSafeInteger(forecast.success_probability_bps) || forecast.success_probability_bps < 0 || forecast.success_probability_bps > 10000) throw new Error("invalid_success_probability");
    const expiry = Date.parse(forecast.valid_until);
    if (typeof forecast.valid_until !== "string" || !Number.isFinite(expiry) || expiry <= now || expiry > now + 3600000) throw new Error("invalid_forecast_expiry");
    for (const key of ["revenue_if_success_usd_micros", "failure_loss_usd_micros", ...COSTS.map(k => `${k}_cost_usd_micros`)]) money(forecast[key]);
  }
  return structuredClone(value);
}
export function evaluateForecast(policy, digest, now = Date.now()) {
  const forecast = policy.forecasts.find(item => item.request_digest === digest);
  if (!forecast) throw new Error("governance_forecast_missing");
  if (now >= Date.parse(forecast.valid_until)) throw new Error("governance_forecast_expired");
  const probability = BigInt(forecast.success_probability_bps);
  // Revenue rounds down; expected failure loss rounds up. Money never uses floats.
  const revenue = money(forecast.revenue_if_success_usd_micros) * probability / 10000n;
  const failureLoss = (money(forecast.failure_loss_usd_micros) * (10000n - probability) + 9999n) / 10000n;
  const operatingCost = COSTS.reduce((sum, key) => sum + money(forecast[`${key}_cost_usd_micros`]), 0n);
  const net = revenue - operatingCost - failureLoss;
  // Reserve worst-case stated loss, including failed attempts. These are configured
  // exposure ceilings, not a guarantee that a vendor cannot invoice a larger amount.
  const exposure = operatingCost + money(forecast.failure_loss_usd_micros);
  return {
    basis: "operator_forecast_not_realized_revenue", currency: "USD",
    expected_gross_usd_micros: revenue.toString(), operating_cost_usd_micros: operatingCost.toString(),
    expected_failure_loss_usd_micros: failureLoss.toString(), net_expected_usd_micros: net.toString(),
    reserved_exposure_usd_micros: exposure.toString(), minimum_net_usd_micros: policy.minimum_net_usd_micros,
    allowed: net > 0n && net > money(policy.minimum_net_usd_micros), valid_until: forecast.valid_until,
    realized_revenue_usd_micros: null, realized_profit_usd_micros: null,
  };
}
export async function proofOperation(env, path, body) {
  const response = await env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName("proofrail-root-v1")).fetch(`https://proofrail/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok || path === "verify" && result.valid !== true || path === "sign" && !result.proof) throw new Error("governance_signature_invalid");
  return result;
}
const gateways = new WeakMap();
/** Singleton per Durable Object storage handle. Durable transactions, rather than
 * this process-local singleton, enforce exclusion across requests and restarts. */
export class XGuardAuthorizationGateway {
  constructor(storage, env) {
    if (gateways.has(storage)) return gateways.get(storage);
    this.storage = storage; this.env = env; gateways.set(storage, this);
  }
  async halt(reason) {
    await this.storage.transaction(async tx => {
      const record = await tx.get("record");
      if (record && !record.demo && record.governance_state !== "HALTED") await tx.put("record", {
        ...record, governance_state: "HALTED", halt_reason: reason, halted_at: new Date().toISOString(),
      });
    });
  }
  async authorize(record, body, economics) {
    const now = Date.now();
    const payload = { typ: GOVERNANCE_TYPE, v: 1, iss: "https://api.xguardgate.com", aud: "xguard-egress",
      capability_id: record.id, request_digest: body.request_digest, key_hash: body.key_hash,
      jti: crypto.randomUUID(), iat: now, exp: Math.min(now + 30000, Date.parse(record.expires_at), Date.parse(economics.valid_until)), economics };
    const signed = await proofOperation(this.env, "sign", { payload });
    return { ok: true, authorization: signed.proof, alg: signed.alg, kid: signed.kid, ...payload };
  }
  async validate(record, body) {
    if (!body.governance_authorization || typeof body.governance_authorization !== "string" || body.governance_authorization.length > 16000) throw new Error("governance_authorization_required");
    const { payload: p } = await proofOperation(this.env, "verify", { proof: body.governance_authorization });
    if (p?.typ !== GOVERNANCE_TYPE || p.v !== 1 || p.iss !== "https://api.xguardgate.com" || p.aud !== "xguard-egress"
      || p.capability_id !== record.id || p.request_digest !== body.request_digest || p.key_hash !== body.key_hash
      || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || p.iat > Date.now() || p.exp > p.iat + 30000 || p.exp <= p.iat) throw new Error("governance_authorization_mismatch");
    return p;
  }
}
/** One UTC-day ledger per operator, shared by all their governed capabilities. */
export async function reserveDailyExposure(storage, body, now = Date.now()) {
  if (!/^xge_[a-f0-9]{32}$/.test(body.execution_id || "")) throw new Error("invalid_governance_reservation");
  const amount = money(body.amount), limit = money(body.limit), day = new Date(now).toISOString().slice(0, 10);
  let output;
  await storage.transaction(async tx => {
    const prior = await tx.get(`governance-reservation:${body.execution_id}`);
    if (prior) {
      if (prior.amount !== body.amount || prior.limit !== body.limit) throw new Error("governance_reservation_conflict");
      output = prior; return;
    }
    const key = `governance-day:${day}`, spent = BigInt((await tx.get(key)) || "0");
    if (spent + amount > limit) { output = { allowed: false, error: "governance_daily_budget_exceeded" }; return; }
    output = { allowed: true, day, amount: body.amount, limit: body.limit, reserved_usd_micros: (spent + amount).toString() };
    await tx.put(key, output.reserved_usd_micros);
    await tx.put(`governance-reservation:${body.execution_id}`, output);
  });
  return output;
}
export const GOVERNANCE_DISCOVERY = Object.freeze({
  version: 1, authorize: "/v1/egress/authorize", execute: "/v1/egress/fetch", halt: "/v1/egress/halt", status: "/v1/egress/governance-status",
  mode: "mandatory_external_capability_governance", secret_location: "gateway_only", authorization_ttl_seconds: 30,
  enforcement: "Every external scoped execution requires an operator policy and signed request-bound authorization, including raw egress. Legacy ungoverned grants are refused. Host egress isolation must also be installed by the operator.",
  migration: "Reconcile and revoke legacy grants, then issue fresh policies; no automatic or agent-controlled upgrade.",
  internal_demo: "Read-only internal fixture only; no network egress, payment or revenue forecast.",
  economics: "Operator-supplied request-bound forecasts; positive expected net value is not guaranteed profit.",
  stop: "Durable capability latch; new work stops. Already submitted remote side effects may finish and require reconciliation.",
  financial_trading_adapter: false, autonomous_market_feed: false,
});
