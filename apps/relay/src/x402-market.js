const API = "https://api.xguardgate.com";
const VERSION = "5.0.1";
const RECONCILE = "https://reconcile.xguardgate.com";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=20",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "x-xguard-facilitator": VERSION,
    ...headers,
  },
});

const cleanBase = value => String(value || "").replace(/\/$/, "");

function upstreams(env) {
  return [...new Set([
    cleanBase(env.X402_GLOBAL_PRIMARY || "https://facilitator.payai.network"),
    cleanBase(env.X402_BASE_PRIMARY || "https://facilitator.xpay.sh"),
    cleanBase(env.X402_BASE_SECONDARY || "https://facilitator.openx402.ai"),
    cleanBase(env.X402_MULTI || "https://x402.dexter.cash"),
  ].filter(Boolean))];
}

async function fetchJson(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": `XGuard-Facilitator-Discovery/${VERSION}`,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return {
      ok: response.ok,
      status: response.status,
      data,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
      error: error?.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function kindsFrom(data) {
  if (Array.isArray(data?.kinds)) return data.kinds;
  if (Array.isArray(data?.paymentKinds)) return data.paymentKinds;
  if (Array.isArray(data?.supported)) return data.supported;
  return [];
}

function kindMatches(kind, network, scheme) {
  if (!kind || typeof kind !== "object") return false;
  const observedNetwork = String(kind.network || kind.caip2 || kind.chain || "");
  const observedScheme = String(kind.scheme || "");
  if (network && observedNetwork && observedNetwork !== network) return false;
  if (scheme && observedScheme && observedScheme !== scheme) return false;
  return Boolean(observedNetwork || observedScheme);
}

async function capabilitySnapshot(env) {
  const rows = await Promise.all(upstreams(env).map(async url => ({ url, ...(await fetchJson(`${url}/supported`)) })));
  const live = rows.filter(row => row.ok && row.data);
  const kinds = [];
  const extensions = [];
  const signers = {};
  const seenKinds = new Set();
  const seenExtensions = new Set();

  for (const row of live) {
    for (const kind of kindsFrom(row.data)) {
      const key = JSON.stringify(kind);
      if (!seenKinds.has(key)) {
        seenKinds.add(key);
        kinds.push(kind);
      }
    }
    for (const extension of Array.isArray(row.data?.extensions) ? row.data.extensions : []) {
      const key = typeof extension === "string" ? extension : JSON.stringify(extension);
      if (!seenExtensions.has(key)) {
        seenExtensions.add(key);
        extensions.push(extension);
      }
    }
    if (row.data?.signers && typeof row.data.signers === "object") Object.assign(signers, row.data.signers);
  }

  return {
    kinds,
    extensions,
    signers,
    live,
    batch_settlement_live: kinds.some(kind => String(kind?.scheme || "") === "batch-settlement"),
  };
}

function discoveryItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.resources)) return data.resources;
  if (Array.isArray(data)) return data;
  return [];
}

function itemKey(item) {
  const resource = String(item?.resource || item?.url || "");
  const method = String(item?.method || item?.extensions?.bazaar?.info?.input?.method || "");
  const tool = String(item?.toolName || item?.tool_name || item?.extensions?.bazaar?.info?.input?.toolName || "");
  return `${resource}|${method}|${tool}`;
}

function searchableText(item) {
  return [
    item?.resource,
    item?.url,
    item?.serviceName,
    item?.name,
    item?.description,
    ...(Array.isArray(item?.tags) ? item.tags : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

async function collectDiscovery(env, searchParams, searchMode = false) {
  const requestedLimit = Number(searchParams.get("limit") || 100);
  const limit = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 100));
  const offsetValue = Number(searchParams.get("offset") || 0);
  const offset = Math.max(0, Number.isFinite(offsetValue) ? Math.trunc(offsetValue) : 0);
  const query = String(searchParams.get("query") || searchParams.get("q") || "").trim();

  const calls = upstreams(env).map(async base => {
    const route = searchMode && query ? "/discovery/search" : "/discovery/resources";
    const url = new URL(`${base}${route}`);
    url.searchParams.set("limit", "200");
    if (searchMode && query) url.searchParams.set("query", query);
    const result = await fetchJson(url.toString(), 4500);
    if (result.ok) return { base, result };

    if (searchMode && query) {
      const fallback = new URL(`${base}/discovery/resources`);
      fallback.searchParams.set("limit", "200");
      return { base, result: await fetchJson(fallback.toString(), 4500) };
    }
    return { base, result };
  });

  const rows = await Promise.all(calls);
  const merged = [];
  const seen = new Set();

  for (const { base, result } of rows) {
    if (!result.ok || !result.data) continue;
    for (const raw of discoveryItems(result.data)) {
      if (!raw || typeof raw !== "object") continue;
      if (searchMode && query && !searchableText(raw).includes(query.toLowerCase())) continue;
      const key = itemKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...raw,
        xguardDiscovery: {
          catalogSource: new URL(base).hostname,
          aggregatedBy: API,
        },
      });
    }
  }

  merged.sort((a, b) => searchableText(a).localeCompare(searchableText(b)));
  const items = merged.slice(offset, offset + limit);

  return {
    x402Version: 2,
    items,
    pagination: {
      limit,
      offset,
      total: merged.length,
    },
    xguard: {
      aggregator: API,
      upstream_catalogs_live: rows.filter(row => row.result.ok).map(row => new URL(row.base).hostname),
      query: searchMode ? query : undefined,
    },
  };
}

async function providerManifest(env) {
  const caps = await capabilitySnapshot(env);
  const free = Math.max(0, Number(env.FREE_SETTLEMENTS || 25));
  const credits = Math.max(1, Number(env.SETTLEMENT_CREDITS || 2));

  return {
    x402Version: 2,
    version: VERSION,
    kind: "facilitator",
    name: "XGuard High-Velocity x402 Facilitator",
    description: "One non-custodial x402 facilitator URL that selects healthy compatible settlement paths, fails over verification and explicit rate-limit rejection, gates ambiguous settlement retries on reconciliation, protects replay-sensitive flows, and reconciles Base USDC outcomes.",
    baseUrl: API,
    facilitator: API,
    endpoints: {
      supported: `${API}/supported`,
      verify: `${API}/verify`,
      settle: `${API}/settle`,
      health: `${API}/healthz`,
      discoveryResources: `${API}/discovery/resources`,
      discoverySearch: `${API}/discovery/search`,
      route: `${API}/v1/facilitator/route`,
      provider: `${API}/facilitator`,
      openapi: `${API}/openapi.json`,
    },
    kinds: caps.kinds,
    extensions: caps.extensions,
    signers: caps.signers,
    capabilities: {
      verify: true,
      settle: true,
      supported: true,
      bazaar_list: true,
      bazaar_search: true,
      automatic_routing: true,
      capability_aware_routing: true,
      health_aware_routing: true,
      latency_aware_routing: true,
      transport_failover: true,
      rate_limit_failover: true,
      verify_transport_failover: true,
      settlement_rate_limit_failover: true,
      settlement_transport_failover: "reconciliation-gated",
      settlement_ambiguous_fail_closed: true,
      durable_replay_guard: true,
      base_timeout_reconciliation: true,
      exact: caps.kinds.some(kind => String(kind?.scheme || "") === "exact"),
      batch_settlement: caps.batch_settlement_live,
      batch_settlement_policy: "Automatically routable when a healthy configured upstream advertises scheme=batch-settlement; never advertised as live otherwise.",
    },
    routing: {
      mode: "automatic",
      strategy: "scheme/network capability -> health -> observed latency",
      configured_upstreams: upstreams(env).map(url => new URL(url).hostname),
      live_upstreams: caps.live.map(row => ({ host: new URL(row.url).hostname, latency_ms: row.latency_ms })),
      integration: "Resource servers configure only https://api.xguardgate.com as their facilitator URL; XGuard selects the downstream settlement path per request.",
      settlement_safety: "429 may fail over because admission was refused. Ambiguous timeout/5xx settlement outcomes fail closed unless reconciliation proves the signed payment was not consumed; Base USDC uses on-chain authorization-state reconciliation.",
    },
    pricing: {
      verify: "free",
      failed_settlement: "free",
      free_successful_settlements_per_payTo: free,
      successful_settlement_after_allowance: `${credits} XGuard Usage Credit${credits === 1 ? "" : "s"}`,
      billing_boundary: "Only successful settlements are consumed from the usage-credit balance; XGuard does not alter the x402 payTo or signed payment amount.",
    },
    custody: "none",
    discovery: {
      bazaar: {
        list: `${API}/discovery/resources`,
        search: `${API}/discovery/search`,
      },
      wellKnown: `${API}/.well-known/x402`,
      dnsCompatibility: {
        name: "_x402.xguardgate.com",
        purpose: "Compatibility advertisement for emerging x402 DNS/well-known discovery resolvers.",
      },
      mcp: `${API}/mcp`,
      agentCard: `${API}/.well-known/agent-card.json`,
    },
    paidResources: [
      {
        url: `${RECONCILE}/v1/reconcile`,
        discovery: `${RECONCILE}/.well-known/x402.json`,
        purpose: "Independent Base USDC settlement reconciliation after ambiguous facilitator outcomes.",
      },
    ],
  };
}

async function routeRecommendation(request, env) {
  const url = new URL(request.url);
  const network = String(url.searchParams.get("network") || "");
  const scheme = String(url.searchParams.get("scheme") || "");
  const caps = await capabilitySnapshot(env);
  let candidates = caps.live.filter(row => kindsFrom(row.data).some(kind => kindMatches(kind, network, scheme)));
  if (!candidates.length && !network && !scheme) candidates = caps.live;
  candidates.sort((a, b) => a.latency_ms - b.latency_ms);

  if (!candidates.length) {
    return json({
      error: "no_live_compatible_route",
      network: network || null,
      scheme: scheme || null,
      facilitator: API,
    }, 503, { "cache-control": "no-store" });
  }

  return json({
    facilitator: API,
    automatic: true,
    network: network || null,
    scheme: scheme || null,
    selected_upstream_host: new URL(candidates[0].url).hostname,
    observed_latency_ms: candidates[0].latency_ms,
    compatible_routes: candidates.map(row => ({ host: new URL(row.url).hostname, latency_ms: row.latency_ms })),
    instruction: "Configure the resource server with the XGuard facilitator URL. Do not pin the selected upstream; XGuard re-routes per request as health/capability changes.",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const read = request.method === "GET" || request.method === "HEAD";

    if (read && (path === "/facilitator" || path === "/.well-known/x402" || path === "/.well-known/x402.json" || path === "/.well-known/x402-facilitator.json" || path === "/.well-known/payment-manifest" || path === "/.well-known/payment-manifest.json")) {
      const response = json(await providerManifest(env), 200, { "cache-control": "public, max-age=30", "x-xguard-discovery": "facilitator" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (read && path === "/discovery/resources") {
      const response = json(await collectDiscovery(env, url.searchParams, false), 200, { "cache-control": "public, max-age=15", "x-xguard-discovery": "bazaar-list" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (read && path === "/discovery/search") {
      const response = json(await collectDiscovery(env, url.searchParams, true), 200, { "cache-control": "public, max-age=15", "x-xguard-discovery": "bazaar-search" });
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (read && path === "/v1/facilitator/route") {
      const response = await routeRecommendation(request, env);
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    return null;
  },
};
