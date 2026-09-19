/** Agent-side client: accepts a scoped capability, never an operator/provider key. */
export function createExecutionClient({ capability, api = "https://api.xguardgate.com", fetch: transport = globalThis.fetch } = {}) {
  if (typeof capability !== "string" || !/^xgc_[a-f0-9]{32}\.[A-Za-z0-9_-]{20,}$/i.test(capability)) throw new TypeError("A scoped XGuard capability is required");
  const base = new URL(api);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new TypeError("Use an HTTPS API origin");
  async function call(path, body, signal) {
    let response;
    try { response = await transport(new URL(path, base), { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch { throw Object.assign(new Error("Delivery is uncertain. Retry only the identical operation and idempotency key."), { code: "delivery_uncertain", mayHaveExecuted: true }); }
    if (response.status >= 300 && response.status < 400) throw Object.assign(new Error("API redirects are refused; the capability was not forwarded."), { code: "redirect_refused", status: response.status });
    let value;
    try { value = await response.json(); }
    catch { throw Object.assign(new Error("Response could not be verified. Preserve the same input and idempotency key."), { code: "invalid_response", status: response.status, mayHaveExecuted: true }); }
    if (!response.ok || value.ok === false || value.valid === false) throw Object.assign(new Error(value.error?.message || value.message || value.error_code || `xguard_http_${response.status}`), { status: response.status, result: value });
    return value;
  }
  return {
    execute({ operation, input, idempotencyKey, signal }) {
      if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_:.-]{8,128}$/.test(idempotencyKey)) throw new TypeError("Provide and retain a stable idempotencyKey for this business operation");
      return call("/v1/secretless/call", { capability, operation, input, idempotency_key: idempotencyKey }, signal);
    },
    preflight({ operation, input, signal }) { return call("/v1/preflight", { capability, operation, input }, signal); },
    verify({ proof, resultSha256, receipt, signal }) { return call("/v1/receipts/verify", { proof, ...(resultSha256 ? { result_sha256: resultSha256 } : {}), ...(receipt ? { receipt } : {}) }, signal); },
  };
}
