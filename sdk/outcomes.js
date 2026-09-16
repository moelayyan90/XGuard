function encodePaymentSignatureHeader(value) {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** One logical call. `payer` is an official x402 client with a caller-owned signer.
 * No payment is created unless maxAmountAtomic and an allowed network/asset match.
 * Payment payloads and recovery quotes are never logged or persisted by this SDK.
 */
export function createXGuardOutcomeClient({ payer, maxAmountAtomic = "0", network = "eip155:8453",
  baseUrl = "https://api.xguardgate.com", fetchImpl = globalThis.fetch, headers = {}, onPaymentPrepared,
  timeoutMs = 30_000 } = {}) {
  if (!/^\d+$/.test(String(maxAmountAtomic))) throw new Error("maxAmountAtomic must be an integer string");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("timeoutMs must be an integer from 1 through 300000");
  const assets = { "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
  if (!assets[network]) throw new Error("Select a supported USDC network");
  if (typeof baseUrl !== "string" || baseUrl.length > 2048) throw new Error("Supply a bounded API origin");
  const checked = new URL(baseUrl);
  const localHttp = checked.protocol === "http:" && ["127.0.0.1", "localhost"].includes(checked.hostname);
  if (checked.protocol !== "https:" && !localHttp || checked.username || checked.password || checked.search || checked.hash || checked.pathname !== "/") throw new Error("Supply an HTTPS API origin without credentials, a path or a query");
  const executeUrl = new URL("/v1/execute", checked).href;
  const transportErrors = new WeakSet();
  // Each HTTP attempt has its own deadline, including reading the response body.
  // Race the deadline as well as aborting so a custom fetch cannot leave us waiting.
  const request = async (url, init) => {
    const controller = new AbortController();
    let timer, timeoutError, readingBody = false;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timeoutError = Object.assign(new Error(`XGuard request timed out after ${timeoutMs} ms`), { name: "TimeoutError", code: "XGUARD_REQUEST_TIMEOUT" });
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        readingBody = true;
        return { response, data: await response.json() };
      })()]);
    } catch (cause) {
      const error = timeoutError || (cause instanceof Error ? cause : new Error(String(cause)));
      // Malformed JSON and HTTP errors are not evidence of a lost response.
      if (!readingBody || timeoutError || error instanceof TypeError || error.name === "AbortError") transportErrors.add(error);
      throw error;
    } finally { clearTimeout(timer); }
  };
  const parse = ({ response, data }) => {
    if (!response.ok) { const error = new Error(data?.message || data?.error?.message || data?.error_code || `HTTP ${response.status}`); Object.assign(error, { status: response.status, data }); throw error; }
    return data;
  };
  return {
    async execute(intent) {
      const body = JSON.stringify(typeof intent === "string" ? { intent } : intent);
      const requestHeaders = { "content-type": "application/json", ...headers };
      let received = await request(executeUrl, { method: "POST", headers: requestHeaders, body, redirect: "manual" });
      if (received.response.status !== 402) return parse(received);
      const challenge = received.data;
      const quote = received.response.headers.get("x-xguard-quote");
      const accepted = challenge.accepts?.[0];
      if (!quote || challenge.resource?.url !== "https://api.xguardgate.com/v1/execute" || challenge.x402Version !== 2 || challenge.accepts?.length !== 1 || !accepted || !/^0x[0-9a-fA-F]{40}$/.test(accepted.payTo || "") || accepted.scheme !== "exact" || accepted.network !== network || String(accepted.asset).toLowerCase() !== assets[network] || !/^\d+$/.test(accepted.amount || "") || BigInt(accepted.amount) > BigInt(maxAmountAtomic)) throw Object.assign(new Error("Payment exceeds the authorized budget or does not match the allowed rail"), { status: 402, data: challenge });
      if (!payer?.createPaymentPayload) throw Object.assign(new Error("A funded x402 payer is required for this outcome"), { status: 402, data: challenge });
      const payload = await payer.createPaymentPayload(challenge);
      const paidHeaders = { ...requestHeaders, "x-xguard-quote": quote, "payment-signature": encodePaymentSignatureHeader(payload) };
      const recovery = { payment_identifier: challenge.extensions?.["payment-identifier"]?.info?.id, quote };
      // Let a caller durably save recovery before the authorization is submitted.
      // A persistence failure must stop here, before any paid HTTP request.
      if (onPaymentPrepared) await onPaymentPrepared({ ...recovery });
      // A transient transport failure retries exactly the same authorization. Never
      // create a second payment just because delivery of the first response is unknown.
      try {
        try { received = await request(executeUrl, { method: "POST", headers: paidHeaders, body, redirect: "manual" }); }
        catch (error) {
          if (!transportErrors.has(error)) throw error;
          received = await request(executeUrl, { method: "POST", headers: paidHeaders, body, redirect: "manual" });
        }
        const data = parse(received);
        data.recovery = { ...recovery, payment_identifier: data.payment_identifier || recovery.payment_identifier };
        return data;
      } catch (error) { error.recovery = recovery; throw error; }
    },
    async getResult({ payment_identifier, quote }) {
      if (!/^pay_[a-zA-Z0-9_-]+$/.test(payment_identifier || "") || typeof quote !== "string") throw new Error("Supply the payment identifier and its original signed quote");
      return parse(await request(new URL(`/v1/results/${encodeURIComponent(payment_identifier)}`, checked).href, { headers: { ...headers, "x-xguard-quote": quote }, redirect: "manual" }));
    },
  };
}
