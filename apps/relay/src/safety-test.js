const VERSION = "1.1.0";
const STANDARD = "XGuard ATS-100";
const API = "https://xguardgate.com/api";
const MAX = 262144;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-safety-test": VERSION,
    "x-xguard-score-standard": "ATS-100",
    ...headers
  }
});
const low = x => String(x ?? "").toLowerCase();
const mutation = m => /^(POST|PUT|PATCH|DELETE)$/i.test(String(m || "POST"));
const hasAny = (h, names) => names.some(n => h.has(n));
const bodyText = b => typeof b === "string" ? b : b == null ? "" : JSON.stringify(b);

function detect(target, method, headers, body) {
  const path = low(new URL(target).pathname), text = bodyText(body), auth = headers.get("authorization") || "";
  if (headers.has("payment-signature") || headers.has("x-payment") || /"x402Version"\s*:/.test(text) || /"paymentRequirements"\s*:/.test(text)) return "x402";
  if (/^\s*Payment\b/i.test(auth) || headers.has("payment-receipt") || /paymentauth\.org/i.test(text)) return "mpp";
  if (/\b(IntentMandate|CartMandate|PaymentMandate)\b/.test(text) || /google-agentic-commerce\/ap2/i.test(headers.get("a2a-extensions") || "")) return "ap2";
  if (path === "/.well-known/ucp" || headers.has("ucp-version") || /"ucp"\s*:/i.test(text)) return "ucp";
  if (/"jsonrpc"\s*:\s*"2\.0"/.test(text) && /"method"\s*:/.test(text)) return "mcp";
  if (/agentic-commerce|\bacp\b/i.test(headers.get("x-protocol") || "") || (/\/(checkout|orders|cart)/.test(path) && /openai|chatgpt/i.test(headers.get("user-agent") || ""))) return "acp";
  if (headers.has("signature") && headers.has("signature-input")) return "signed-http";
  return "http";
}

function extract(body) {
  const b = body && typeof body === "object" ? body : {};
  const req = b.paymentRequirements || b.requirements || b.payment?.paymentRequirements || null;
  const pay = b.paymentPayload || b.payment || b.payload || null;
  const accepted = pay?.accepted || b.accepted || null;
  const auth = pay?.payload?.authorization || pay?.authorization || b.authorization || null;
  return { req, pay, accepted, auth };
}

function x402Binding(body) {
  const { req, accepted, auth } = extract(body);
  if (!req || !accepted) return { ok: false, detail: "payment requirements are not visibly bound to an accepted payload", replay: !!auth?.nonce, freshness: !!(auth?.validBefore || auth?.validAfter) };
  const fields = ["scheme", "network", "asset", "payTo", "amount"];
  const mismatches = fields.filter(f => req[f] != null && accepted[f] != null && low(req[f]) !== low(accepted[f]));
  return { ok: mismatches.length === 0, mismatches, replay: !!auth?.nonce, freshness: !!(auth?.validBefore || auth?.validAfter) };
}

function evaluate(input) {
  const target = String(input.target || "https://example.com/agent-action");
  let u;
  try { u = new URL(target); } catch { return { error: "invalid_target" }; }
  if (u.protocol !== "https:") return { error: "https_required" };
  const method = String(input.method || "POST").toUpperCase();
  const headers = new Headers(input.headers || {});
  const body = input.body ?? null;
  const text = bodyText(body);
  const protocol = detect(target, method, headers, body);
  const checks = [];
  const risks = [];
  const fixes = [];
  let score = 0;
  const add = (id, max, earned, detail) => { score += earned; checks.push({ id, earned, max, pass: earned === max, detail }); };

  if (protocol !== "http") add("protocol_identification", 15, 15, `${protocol} was structurally identifiable`);
  else { add("protocol_identification", 15, 5, "generic HTTPS only; no agent transaction protocol was structurally identifiable"); risks.push({ severity: "medium", code: "ambiguous_transaction_protocol" }); fixes.push("Declare or expose a stable agent transaction protocol surface."); }

  if (!mutation(method)) add("idempotency", 20, 20, "read-only request; mutation idempotency is not required");
  else if (hasAny(headers, ["idempotency-key", "x-idempotency-key"])) add("idempotency", 20, 20, "explicit idempotency key present");
  else { add("idempotency", 20, 0, "mutation has no explicit idempotency key"); risks.push({ severity: "high", code: "retry_can_duplicate_side_effect" }); fixes.push("Require an Idempotency-Key on every state-changing agent call."); }

  let binding = false, replay = false, freshness = false;
  if (protocol === "x402") {
    const x = x402Binding(body);
    binding = x.ok; replay = x.replay; freshness = x.freshness;
    if (x.mismatches?.length) risks.push({ severity: "critical", code: "x402_context_binding_mismatch", fields: x.mismatches });
  } else if (protocol === "ap2") {
    const payment = /PaymentMandate|payment[_-]?mandate/i.test(text);
    const cart = /CartMandate|cart[_-]?mandate|cartMandate|intent[_-]?mandate|IntentMandate/i.test(text);
    binding = !payment || cart;
    replay = /nonce|mandate[_-]?id|mandateId|credential[_-]?id/i.test(text);
    freshness = /expir|validBefore|valid_after|timestamp|issuedAt/i.test(text) || hasAny(headers, ["date", "timestamp"]);
    if (payment && !cart) risks.push({ severity: "critical", code: "ap2_payment_context_not_visibly_bound" });
  } else {
    binding = hasAny(headers, ["signature", "signature-input", "payment-signature", "x-payment"]) || /mandate|allowance|payTo|recipient|amount|resource/i.test(text);
    replay = hasAny(headers, ["idempotency-key", "x-idempotency-key", "payment-receipt"]) || /nonce|request[_-]?id|transaction[_-]?id|payment[_-]?id/i.test(text);
    freshness = hasAny(headers, ["date", "timestamp", "signature-input"]) || /expir|validBefore|validAfter|timestamp/i.test(text);
  }

  if (binding) add("context_binding", 25, 25, "transaction context has an explicit binding signal");
  else { add("context_binding", 25, 0, "recipient/resource/amount or mandate context is not visibly bound"); risks.push({ severity: "critical", code: "context_redirect_or_confused_deputy_risk" }); fixes.push("Bind authorization to the exact resource, recipient, amount and transaction context at execution time."); }

  if (replay) add("replay_uniqueness", 15, 15, "nonce, idempotency or transaction uniqueness signal present");
  else { add("replay_uniqueness", 15, 0, "no consume-once or replay uniqueness signal detected"); risks.push({ severity: "high", code: "replay_risk" }); fixes.push("Add consume-once replay state using a nonce, mandate ID, payment ID or durable idempotency record."); }

  if (freshness) add("freshness_window", 10, 10, "expiry or freshness signal present");
  else { add("freshness_window", 10, 0, "no expiry/freshness signal detected"); risks.push({ severity: "medium", code: "stale_authorization_risk" }); fixes.push("Add a bounded validity window or signed timestamp."); }

  const trace = hasAny(headers, ["request-id", "x-request-id", "traceparent", "signature", "signature-input", "authorization", "payment-signature", "x-payment"]);
  if (trace) add("traceability_authorization", 15, 15, "authorization, signature or request trace signal present");
  else { add("traceability_authorization", 15, 0, "no authorization/signature/request correlation signal detected"); risks.push({ severity: "medium", code: "weak_auditability" }); fixes.push("Add signed authorization and a stable request correlation ID."); }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const verdict = score >= 90 ? "production-ready signals" : score >= 75 ? "material gaps remain" : "unsafe for autonomous retries without additional controls";
  const host = u.host;
  return {
    name: "XGuard Agent Transaction Safety Test",
    score_standard: STANDARD,
    standard_version: "2026-08-25",
    version: VERSION,
    protocol,
    operation: mutation(method) ? "mutation" : "read",
    score,
    grade,
    verdict,
    checks,
    risks,
    fixes: [...new Set(fixes)],
    xguard_fix: {
      why: "XGuard can enforce policy, replay controls and success-only metering in-path instead of relying on each protocol implementation to get retries right.",
      authorize: `_xguard.${u.hostname} TXT \"xguard-edge=enabled\"`,
      edge_url: `${API}/edge/${host}${u.pathname}`
    },
    evidence_note: "ATS-100 is a structural runtime-readiness score of the supplied sample, not a certification or proof that the remote merchant endpoint behaves correctly.",
    privacy_note: "Do not submit live card data, private keys, bearer secrets or production credentials. XGuard does not echo submitted secret values in the report."
  };
}

function schema() {
  return {
    name: "XGuard Agent Transaction Safety Test",
    score_standard: STANDARD,
    standard_version: "2026-08-25",
    version: VERSION,
    free: true,
    score_range: [0, 100],
    weights: {
      protocol_identification: 15,
      idempotency: 20,
      context_binding: 25,
      replay_uniqueness: 15,
      freshness_window: 10,
      traceability_authorization: 15
    },
    grades: { A: "90-100", B: "80-89", C: "70-79", D: "60-69", F: "0-59" },
    protocols: ["x402", "MPP", "AP2", "UCP", "ACP", "MCP", "signed HTTP", "generic HTTPS"],
    endpoint: "POST /v1/test",
    input: { target: "https://merchant.example/checkout", method: "POST", headers: { "Idempotency-Key": "demo-123" }, body: {} },
    checks: ["protocol identification", "idempotency", "context binding", "replay uniqueness", "freshness window", "traceability/authorization"],
    web_test: "https://xguardgate.com/test",
    specification: "https://github.com/moelayyan90/XGuard/blob/main/specs/ATS-100.md"
  };
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/v1/test/schema" && request.method === "GET") return json(schema(), 200, { "cache-control": "public, max-age=300" });
    if (u.pathname !== "/v1/test" || request.method !== "POST") return null;
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX) return json({ error: "body_too_large" }, 413);
    let input;
    try {
      const raw = await request.text();
      if (raw.length > MAX) return json({ error: "body_too_large" }, 413);
      input = JSON.parse(raw);
    } catch { return json({ error: "invalid_json" }, 400); }
    const report = evaluate(input || {});
    if (report.error) return json(report, 400);
    return json(report, 200, { "access-control-allow-origin": "https://xguardgate.com" });
  }
};
