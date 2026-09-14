// Payment trust is rebuilt from this request, never from a prior Worker isolate.
const BASE = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const isAddress = x => /^0x[0-9a-fA-F]{40}$/.test(String(x || ""));
const isNonce = x => /^0x[0-9a-fA-F]{64}$/.test(String(x || ""));
const lower = x => String(x ?? "").toLowerCase();
const amount = x => {
  const s = String(x ?? "");
  if (/^[0-9]+$/.test(s)) { try { return BigInt(s).toString(); } catch {} }
  return s;
};
const sameAddress = (a, b) => isAddress(a) && isAddress(b) ? lower(a) === lower(b) : String(a ?? "") === String(b ?? "");

function extract(body) {
  const requirements = body?.paymentRequirements || body?.requirements || body?.payment?.paymentRequirements || null;
  const paymentPayload = body?.paymentPayload || body?.payment || body?.payload || null;
  const accepted = paymentPayload?.accepted || body?.accepted || null;
  const authorization = paymentPayload?.payload?.authorization || paymentPayload?.authorization || body?.authorization || null;
  return { requirements, paymentPayload, accepted, authorization };
}

function block(reason, detail = {}) {
  return { ok: false, reason, detail };
}

export function inspectPayment(body) {
  const { requirements: r, paymentPayload: p, accepted: a, authorization: z } = extract(body);
  const versions = [body?.x402Version, p?.x402Version].filter(v => v !== undefined && v !== null && v !== "");
  if (versions.some(v => Number(v) !== 2)) return block("unsupported_x402_version", { observed: versions });
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const missing = [
    !object(r) && "paymentRequirements",
    !object(p) && "paymentPayload",
    !object(a) && "paymentPayload.accepted",
  ].filter(Boolean);
  if (missing.length) return block("missing_payment_context", { missing_fields: missing, required_body: ["paymentPayload", "paymentRequirements"], stateless: true });
  if (Number(p.x402Version) !== 2) return block("unsupported_x402_version");
  // Conflicting aliases must never be inspected as one payment and forwarded as another.
  for (const [field, values] of [
    ["paymentRequirements", [body.paymentRequirements, body.requirements, body.payment?.paymentRequirements]],
    ["paymentPayload", [body.paymentPayload, body.payment, body.payload]],
    ["accepted", [p.accepted, body.accepted]],
    ["authorization", [p.payload?.authorization, p.authorization, body.authorization]],
  ]) {
    const present = values.filter(value => value !== undefined && value !== null);
    if (present.length > 1 && present.some(value => canonical(value) !== canonical(present[0]))) return block("conflicting_payment_context", { field });
  }

  const required = ["scheme", "network", "asset", "payTo", "amount"];
  for (const field of required) if (r[field] === undefined || r[field] === null || r[field] === "") return block(`missing_requirement_${field}`);
  for (const field of required) if (a[field] === undefined || a[field] === null || a[field] === "") return block(`missing_accepted_${field}`);

  if (String(r.scheme) !== String(a.scheme)) return block("scheme_binding_mismatch");
  if (String(r.network) !== String(a.network)) return block("network_binding_mismatch");
  if (!sameAddress(r.asset, a.asset)) return block("asset_binding_mismatch");
  if (!sameAddress(r.payTo, a.payTo)) return block("recipient_binding_mismatch");
  if (amount(r.amount) !== amount(a.amount)) return block("amount_binding_mismatch");

  const baseExact = String(r.network) === BASE && String(r.scheme) === "exact";
  const baseUsdc = baseExact && lower(r.asset) === lower(BASE_USDC);
  if (baseUsdc) {
    if (!z) return block("missing_eip3009_authorization");
    if (!isAddress(z.from)) return block("invalid_authorizer");
    if (!isAddress(z.to)) return block("invalid_authorization_recipient");
    if (!isNonce(z.nonce)) return block("invalid_authorization_nonce");
    if (!sameAddress(z.to, r.payTo)) return block("authorization_recipient_mismatch");
    if (amount(z.value) !== amount(r.amount)) return block("authorization_amount_mismatch");

    const now = Math.floor(Date.now() / 1000);
    const before = Number(z.validBefore);
    const after = Number(z.validAfter);
    if (!Number.isFinite(before) || before <= now - 10) return block("authorization_expired");
    if (!Number.isFinite(after) || after > now + 120) return block("authorization_not_yet_valid");
  }

  return {
    ok: true,
    mode: baseUsdc ? "base_usdc_strict" : "context_binding",
    network: String(r.network),
    scheme: String(r.scheme),
    payTo: String(r.payTo),
    amount: String(r.amount),
    body: {
      x402Version: 2,
      paymentPayload: { ...p, accepted: a, ...(z && !p.payload?.authorization ? { payload: { ...(p.payload || {}), authorization: z } } : {}) },
      paymentRequirements: r,
    }
  };
}


function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

export async function paymentContextDigest(body) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(body)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Only the configured upstream's fresh verification result enters this function.
// Request headers, client "isValid" fields, and previous /verify calls grant no trust.
export async function createTrustedVerifiedPaymentContext(body, verification, verifiedBy) {
  const inspection = inspectPayment(body);
  if (!inspection.ok || verification?.isValid !== true || !verifiedBy) throw new Error("payment_context_not_verified");
  const payer = inspection.body.paymentPayload.payload?.authorization?.from;
  if (payer && verification.payer && !sameAddress(payer, verification.payer)) throw new Error("verified_payer_mismatch");
  return Object.freeze({
    kind: "TrustedVerifiedPaymentContext",
    request_digest: await paymentContextDigest(inspection.body),
    verified_at: new Date().toISOString(),
    verified_by: verifiedBy,
    network: inspection.network,
    payer: verification.payer || payer || null,
    body: inspection.body,
  });
}
