// Production negative probes: deliberately invalid signatures; no funded signer.
const API = "https://api.xguardgate.com";
const headers = { "content-type": "application/json", "x-xguard-traffic-class": "synthetic", "user-agent": "XGuard-Settlement-Context-Verifier/1.0" };
async function post(body) {
  const response = await fetch(API + "/settle", { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(45000) });
  return { response, body: await response.json() };
}
const missing = await post({});
if (missing.response.status !== 400 || missing.body.reason !== "missing_payment_context" || missing.body.detail?.missing_fields?.length !== 3) throw new Error("Missing payment context must remain blocked with precise repair fields");
const requirements = { scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x3333333333333333333333333333333333333333", amount: "1", maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } };
const payload = { x402Version: 2, accepted: requirements, payload: { signature: "0x" + "0".repeat(130),
  authorization: { from: "0x1111111111111111111111111111111111111111", to: requirements.payTo, value: "1",
    validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "0".repeat(64) } } };
const invalid = await post({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements, isValid: true });
if (invalid.response.status !== 400 || invalid.response.headers.get("x-xguard-firewall") !== "pass"
  || invalid.response.headers.get("x-xguard-payment-context") !== "verification_failed" || invalid.body.success !== false) {
  throw new Error("A complete envelope must reach verification and an invalid signature must never settle: " + JSON.stringify({ status: invalid.response.status, reason: invalid.body.errorReason || invalid.body.reason }));
}
console.log(JSON.stringify({ observed_at: new Date().toISOString(), ok: true, missing_context_blocked: true,
  complete_context_reaches_verification: true, invalid_signature_blocked_before_settlement: true,
  client_claimed_verification_ignored: true, real_payment_performed: false, worker_version: invalid.response.headers.get("x-xguard-worker-version-tag") }));
