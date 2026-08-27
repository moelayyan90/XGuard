import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";

export const XGUARD_FACILITATOR_URL = "https://api.xguardgate.com";
export const XGUARD_MCP_URL = `${XGUARD_FACILITATOR_URL}/mcp`;
export const XGUARD_VERSION = "5.0.1";

function normalizeBaseUrl(value) {
  const input = String(value || XGUARD_FACILITATOR_URL);
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 47) end -= 1;
  return input.slice(0, end);
}

function getFetch(fetchImpl) {
  const candidate = fetchImpl || globalThis.fetch;
  if (typeof candidate !== "function") {
    throw new Error("XGuard SDK requires a Fetch-compatible implementation");
  }
  return candidate;
}

async function getJson(path, options = {}) {
  const {
    baseUrl = XGUARD_FACILITATOR_URL,
    fetchImpl,
    headers = {},
    signal,
  } = options;
  const response = await getFetch(fetchImpl)(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: "GET",
    headers: { accept: "application/json", ...headers },
    signal,
  });
  if (!response.ok) {
    throw new Error(`XGuard ${path} failed with HTTP ${response.status}`);
  }
  return response.json();
}

export function xguardFacilitatorConfig(options = {}) {
  const {
    licenseKey = "",
    timeoutMs = 30_000,
    baseUrl = XGUARD_FACILITATOR_URL,
  } = options;
  return {
    url: normalizeBaseUrl(baseUrl),
    timeoutMs,
    createAuthHeaders: async () => {
      const settle = licenseKey
        ? { Authorization: `Bearer ${licenseKey}` }
        : {};
      return {
        supported: {},
        verify: {},
        settle,
      };
    },
  };
}

export function createXGuardFacilitator(options = {}) {
  return new HTTPFacilitatorClient(xguardFacilitatorConfig(options));
}

/**
 * Zero-configuration facilitator for free verification / free settlement allowance.
 * Merchants with XGuard Usage Credits should use createXGuardFacilitator({ licenseKey }).
 */
export const facilitator = createXGuardFacilitator();

/**
 * Creates the official x402 resource-server object with XGuard as its facilitator.
 * Register the network/scheme implementations your application accepts on the returned server.
 */
export function createXGuardResourceServer(options = {}) {
  const facilitatorClient = options.facilitatorClient || createXGuardFacilitator(options);
  return new x402ResourceServer(facilitatorClient);
}

export async function xguardSupported(options = {}) {
  return getJson("/supported", options);
}

export async function xguardHealth(options = {}) {
  return getJson("/healthz", options);
}

export async function xguardFacilitator(options = {}) {
  return getJson("/facilitator", options);
}

export async function xguardRoute(options = {}) {
  const { network, scheme, ...requestOptions } = options;
  if (!network || !scheme) {
    throw new Error("xguardRoute requires network and scheme");
  }
  const query = new URLSearchParams({ network: String(network), scheme: String(scheme) });
  return getJson(`/v1/facilitator/route?${query}`, requestOptions);
}

export async function xguardDiscoveryResources(options = {}) {
  const {
    type,
    payTo,
    scheme,
    network,
    extensions,
    limit,
    offset,
    ...requestOptions
  } = options;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ type, payTo, scheme, network, extensions, limit, offset })) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : "";
  return getJson(`/discovery/resources${suffix}`, requestOptions);
}

export async function xguardDiscoverySearch(query, options = {}) {
  if (!query) throw new Error("xguardDiscoverySearch requires a query");
  const params = new URLSearchParams({ query: String(query) });
  return getJson(`/discovery/search?${params}`, options);
}
