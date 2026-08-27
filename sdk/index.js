import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";

export const XGUARD_FACILITATOR_URL = "https://xguardgate.com/api";
export const XGUARD_MCP_URL = `${XGUARD_FACILITATOR_URL}/mcp`;
export const XGUARD_EGRESS_URL = `${XGUARD_FACILITATOR_URL}/v1/egress`;
export const XGUARD_VERSION = "5.0.1";

function normalizeBaseUrl(value) {
  const input = String(value || XGUARD_FACILITATOR_URL);
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 47) end -= 1;
  return input.slice(0, end);
}

function getFetch(fetchImpl) {
  const candidate = fetchImpl || globalThis.fetch;
  if (typeof candidate !== "function") throw new Error("XGuard SDK requires a Fetch-compatible implementation");
  return candidate;
}

async function getJson(path, options = {}) {
  const { baseUrl = XGUARD_FACILITATOR_URL, fetchImpl, headers = {}, signal } = options;
  const response = await getFetch(fetchImpl)(`${normalizeBaseUrl(baseUrl)}${path}`, { method: "GET", headers: { accept: "application/json", ...headers }, signal });
  if (!response.ok) throw new Error(`XGuard ${path} failed with HTTP ${response.status}`);
  return response.json();
}

async function xguardJson(path, options = {}) {
  const { baseUrl = XGUARD_FACILITATOR_URL, fetchImpl, xguardKey = "", body, method = "POST", headers = {}, signal } = options;
  const requestHeaders = { accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["content-type"] = requestHeaders["content-type"] || "application/json";
  if (xguardKey) requestHeaders["x-xguard-key"] = xguardKey;
  const response = await getFetch(fetchImpl)(`${normalizeBaseUrl(baseUrl)}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error ? `XGuard ${path}: ${data.error}` : `XGuard ${path} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function xguardFacilitatorConfig(options = {}) {
  const { licenseKey = "", timeoutMs = 30_000, baseUrl = XGUARD_FACILITATOR_URL } = options;
  return {
    url: normalizeBaseUrl(baseUrl),
    timeoutMs,
    createAuthHeaders: async () => ({ supported: {}, verify: {}, settle: licenseKey ? { Authorization: `Bearer ${licenseKey}` } : {} }),
  };
}

export function createXGuardFacilitator(options = {}) {
  return new HTTPFacilitatorClient(xguardFacilitatorConfig(options));
}

export const facilitator = createXGuardFacilitator();

export function createXGuardResourceServer(options = {}) {
  const facilitatorClient = options.facilitatorClient || createXGuardFacilitator(options);
  return new x402ResourceServer(facilitatorClient);
}

export async function xguardSupported(options = {}) { return getJson("/supported", options); }
export async function xguardHealth(options = {}) { return getJson("/healthz", options); }
export async function xguardFacilitator(options = {}) { return getJson("/facilitator", options); }
export async function xguardEgressManifest(options = {}) { return getJson("/v1/egress", options); }
export async function xguardEgressProviders(options = {}) { return getJson("/v1/egress/providers", options); }
export async function xguardEgressPricing(options = {}) { return getJson("/v1/egress/pricing", options); }

/** Operator-only. Keep this call outside model context. */
export async function xguardCreateCredential(options = {}) {
  const { xguardKey, credential, ...requestOptions } = options;
  if (!xguardKey) throw new Error("xguardCreateCredential requires xguardKey");
  if (!credential || typeof credential !== "object") throw new Error("xguardCreateCredential requires credential");
  return xguardJson("/v1/egress/credentials", { ...requestOptions, xguardKey, body: credential });
}

/** Operator-only. Returns metadata, never the stored secret. */
export async function xguardListCredentials(options = {}) {
  const { xguardKey, baseUrl = XGUARD_FACILITATOR_URL, fetchImpl, signal } = options;
  if (!xguardKey) throw new Error("xguardListCredentials requires xguardKey");
  const response = await getFetch(fetchImpl)(`${normalizeBaseUrl(baseUrl)}/v1/egress/credentials`, { headers: { accept: "application/json", "x-xguard-key": xguardKey }, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `XGuard credential list failed with HTTP ${response.status}`);
  return data;
}

/** Operator-only. Give only the returned capability to the agent. */
export async function xguardIssueCapability(options = {}) {
  const { xguardKey, capability, ...requestOptions } = options;
  if (!xguardKey) throw new Error("xguardIssueCapability requires xguardKey");
  if (!capability || typeof capability !== "object") throw new Error("xguardIssueCapability requires capability scope");
  return xguardJson("/v1/egress/capabilities", { ...requestOptions, xguardKey, body: capability });
}

/** Agent-facing. The upstream reusable credential is never required here. */
export async function xguardEgressFetch(options = {}) {
  const { capability, target, method = "GET", headers = {}, bodyJson, bodyText, bodyBase64, contentType, baseUrl = XGUARD_FACILITATOR_URL, fetchImpl, signal } = options;
  if (!capability) throw new Error("xguardEgressFetch requires capability");
  if (!target) throw new Error("xguardEgressFetch requires target");
  const payload = { capability, target, method, headers };
  if (bodyJson !== undefined) payload.body_json = bodyJson;
  if (bodyText !== undefined) payload.body_text = bodyText;
  if (bodyBase64 !== undefined) payload.body_base64 = bodyBase64;
  if (contentType) payload.content_type = contentType;
  return getFetch(fetchImpl)(`${normalizeBaseUrl(baseUrl)}/v1/egress/fetch`, { method: "POST", headers: { "content-type": "application/json", accept: "*/*" }, body: JSON.stringify(payload), signal });
}

/**
 * Drop-in secretless client for agents.
 * Usage: const agent = createXGuardAgentClient(capability); await agent.fetch(url, { method: "POST", json: {...} });
 */
export function createXGuardAgentClient(capability, options = {}) {
  if (!capability) throw new Error("createXGuardAgentClient requires capability");
  return {
    async fetch(target, init = {}) {
      const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
      const request = {
        capability,
        target: String(target),
        method: init.method || "GET",
        headers,
        baseUrl: options.baseUrl,
        fetchImpl: options.fetchImpl,
        signal: init.signal,
      };
      if (Object.hasOwn(init, "json")) request.bodyJson = init.json;
      else if (typeof init.body === "string") { request.bodyText = init.body; request.contentType = headers["content-type"] || headers["Content-Type"]; }
      else if (init.body !== undefined && init.body !== null) throw new Error("XGuard agent client supports init.json or string init.body; use xguardEgressFetch for base64 bodies");
      return xguardEgressFetch(request);
    },
  };
}

export async function xguardRoute(options = {}) {
  const { network, scheme, ...requestOptions } = options;
  if (!network || !scheme) throw new Error("xguardRoute requires network and scheme");
  const query = new URLSearchParams({ network: String(network), scheme: String(scheme) });
  return getJson(`/v1/facilitator/route?${query}`, requestOptions);
}

export async function xguardDiscoveryResources(options = {}) {
  const { type, payTo, scheme, network, extensions, limit, offset, ...requestOptions } = options;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ type, payTo, scheme, network, extensions, limit, offset })) if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  return getJson(`/discovery/resources${query.size ? `?${query}` : ""}`, requestOptions);
}

export async function xguardDiscoverySearch(query, options = {}) {
  if (!query) throw new Error("xguardDiscoverySearch requires a query");
  return getJson(`/discovery/search?${new URLSearchParams({ query: String(query) })}`, options);
}
