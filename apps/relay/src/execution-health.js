import { VERSION, NAME } from "./core/identity.js";
import { readiness } from "./paid-agent-entry.js";
import { executionTelemetryStub } from "./core/execution-telemetry.js";
import { paymentHealthStub } from "./core/payment-health.js";
import { digestBytes } from "./core/execution-contract.js";
import { reconciliationRpcHealth } from "./core/reconcile-payment.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function deadline(task, ms = 2500) {
  let timer;
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("dependency_timeout")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function probe(task) { try { const r = await deadline(task()); return { ready: r.ok === true, status: r.ok ? "ready" : "unavailable" }; } catch { return { ready: false, status: "unavailable" }; } }
export async function executionReadiness(env) {
  const bindings = ["EGRESS_KEYS", "EGRESS_CREDENTIALS", "EGRESS_CAPABILITIES", "EGRESS_TENANTS", "EGRESS_METER", "PROOF_AUTHORITY"];
  const missing = bindings.filter(k => !env[k]);
  if (missing.length) return { ready: false, status: "missing_bindings", missing, upstream_provider_health: "checked at execution" };
  const [keys, proof, state, billing] = await Promise.all([
    probe(() => env.EGRESS_KEYS.get(env.EGRESS_KEYS.idFromName("root-v1")).fetch("https://egress-key/public")),
    probe(() => env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName("proofrail-root-v1")).fetch("https://proofrail/public")),
    probe(() => executionTelemetryStub(env).fetch("https://meter/telemetry/snapshot")),
    probe(() => fetch(`${String(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com").replace(/\/$/, "")}/healthz`, { redirect: "manual", signal: AbortSignal.timeout(2000) })),
  ]);
  const price = Number(env.EGRESS_EXECUTION_CREDITS || "1");
  const ready = [keys, proof, state, billing].every(x => x.ready) && Number.isSafeInteger(price) && price > 0;
  return { ready, status: ready ? "ready" : "not_ready", checks: { encryption: keys, signing: proof, state, billing }, upstream_provider_health: "checked at execution", operator_balance: "not checked by public readiness" };
}
export async function handleExecutionHealth(request, env) {
  const path = new URL(request.url).pathname;
  if (!["GET", "HEAD"].includes(request.method)) return null;
  if (["/v1/mcp/readiness", "/v1/a2a/readiness"].includes(path)) return json({ ready: true, version: VERSION, mode: "stateless", discovery: "local and deterministic", execution_dependencies: "/v1/egress/readiness" });
  if (path === "/v1/egress/readiness") { const state = await executionReadiness(env); return json(state, state.ready ? 200 : 503); }
  if (path === "/v1/facilitators/health") {
    if (!env.PAID_GATEWAY) return json({ observed: null, reason: "payment_state_missing" }, 503);
    try { return json(await (await deadline(paymentHealthStub(env).fetch("https://health/facilitator/snapshot"))).json()); }
    catch { return json({ observed: null, reason: "health_store_unavailable" }, 503); }
  }
  if (path === "/v1/operator/kpi" || /^\/v1\/operator\/events\/xgr_[A-Za-z0-9_-]{1,124}$/.test(path)) {
    const key = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!env.XGUARD_OPERATOR_METRICS_KEY) return json({ error: "operator_metrics_not_configured" }, 503);
    if (!key || await digestBytes(key) !== await digestBytes(env.XGUARD_OPERATOR_METRICS_KEY)) return json({ error: "operator_authentication_required" }, 401);
    try {
      if (path.includes("/events/")) {
        const id = path.split("/").pop();
        return env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName(`journey:${id}`)).fetch("https://journal/journal/read");
      }
      const stub = env.PAID_GATEWAY?.get(env.PAID_GATEWAY.idFromName("xguard-paid-gateway-index-v1"));
      if (!stub) throw new Error("missing_state");
      const response = await deadline(stub.fetch("https://paid/index/metrics", { method: "POST", body: "{}" }));
      if (!response.ok) throw new Error("unavailable");
      const metrics = await response.json();
      const observed = await (await executionTelemetryStub(env).fetch("https://meter/telemetry/snapshot")).json();
      const registry = await (await env.EGRESS_METER.get(env.EGRESS_METER.idFromName("operator-capability-registry-v1")).fetch("https://meter/operator/snapshot")).json();
      return json({ name: NAME, version: VERSION, economics: metrics.economics, execution: observed,
        active_operators: registry.active_operators, active_capabilities: registry.active_capabilities, capability_inventory: registry,
        definitions: { real_external_paid_execution: "production external settlement plus successful durable delivery; excludes self-payment, demos, testnet, probes and canaries", revenue: "recognized after delivery; settled cash and unfulfilled liability reported separately" } });
    } catch { return json({ error: "operator_metrics_unavailable" }, 503); }
  }
  if (["/healthz", "/v1/reconciliation/readiness"].includes(path)) {
    const [egress, payment, rpc] = await Promise.all([executionReadiness(env), deadline(readiness(env), 6500).catch(() => ({ ready: false, production_payment_ready: false, reason: "payment_dependency_unavailable" })), reconciliationRpcHealth(env)]);
    const ready = path.includes("reconciliation") ? rpc.ready && Boolean(env.PAID_GATEWAY) : egress.ready && payment.production_payment_ready && rpc.ready;
    return json({ name: NAME, version: VERSION, ready, status: ready ? "ready" : "not_ready", checked_at: new Date().toISOString(),
      components: { mcp: { ready: true, discovery: "local" }, a2a: { ready: true, discovery: "local" }, egress, payment, reconciliation: { ...rpc, mode: "read-only chain evidence; no resettlement", durable_state: Boolean(env.PAID_GATEWAY) } } }, ready ? 200 : 503);
  }
  return null;
}
