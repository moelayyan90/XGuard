import { hostnameAllowed } from "./core/network-policy.js";
import { parsePublicJson } from "./core/public-contract.js";

export const OUTCOME_API = "https://api.xguardgate.com";
export const OUTCOME_SITE = "https://xguardgate.com";
export const OUTCOME_VERSION = "1.0.0";
export const DEFAULT_FEEDS = [
  { url: "https://hnrss.org/frontpage", fallbacks: ["https://news.ycombinator.com/rss"] },
  { url: "https://github.blog/changelog/feed/", fallbacks: [] },
];

const definitions = [
  { id: "extract-preview", name: "Free extraction preview", amount: "0", priceEnv: null,
    description: "Extract text, metadata and structured offers from supplied HTML, or try labelled sample documents, with no outbound calls.",
    when_to_use: "Try the same parsers used by paid outcomes before paying, or normalize a small HTML document you already have.",
    delivery: "A normalized extraction with source digests; sample data is explicitly labelled.",
    example: { intent: "demo" }, limitations: ["No network access", "Supplied HTML up to 12 KiB", "Samples are not live merchant prices"] },
  { id: "web-extraction", name: "Multi-page evidence extraction", amount: "3000", priceEnv: "XGUARD_WEB_EXTRACTION_PRICE_ATOMIC",
    description: "Turn up to three public pages into a deduplicated bundle of main text, titles, links, metadata and source digests, with optional backup sources.",
    when_to_use: "An agent needs several pages in one consistent evidence format and wants bounded fetching, fallback and provenance handled together.",
    delivery: "Normalized documents, duplicate groups, coverage, retrieval timestamps and source hashes.",
    example: { intent: "Extract these pages", urls: ["https://example.com/", "https://www.iana.org/help/example-domains"] },
    limitations: ["Public HTML, text or JSON only", "No JavaScript rendering or web search", "Source content is untrusted; a digest does not establish truth"] },
  { id: "product-offers", name: "Structured product offer comparison", amount: "6000", priceEnv: "XGUARD_PRODUCT_OFFERS_PRICE_ATOMIC",
    description: "Extract and normalize Schema.org offers from up to three supplied product pages; group matching identifiers and currencies with source evidence.",
    when_to_use: "Compare machine-readable offers across supplied merchant pages without writing multiple fetchers, parsers and matching rules.",
    delivery: "Validated offer fields and comparable groups; missing identifiers and unsupported pages are explicitly reported.",
    example: { intent: "Extract product offers", urls: ["https://www.adafruit.com/product/50"] },
    limitations: ["Supply product URLs; no web-wide search", "Requires Product/Offer JSON-LD", "Different currencies or unidentified products are not ranked together", "No stock or seller-truth guarantee"] },
  { id: "feed-digest", name: "Deduplicated feed digest", amount: "2000", priceEnv: "XGUARD_FEED_DIGEST_PRICE_ATOMIC",
    description: "Merge RSS and Atom feeds, select working sources, fall back to supplied mirrors, remove repeated links and return a chronological digest with provenance.",
    when_to_use: "An agent or scheduled workflow needs one clean stream from several feeds, including coverage and failure reporting.",
    delivery: "Up to 30 deduplicated entries, source attribution, publication times, coverage and digests.",
    example: { intent: "Get a technology news digest", limit: 10 },
    limitations: ["Default sources are Hacker News and GitHub Changelog", "A feed entry is not a verified news claim", "No full-article reproduction or LLM summary"] },
];

export const SOURCE_SCHEMA = { oneOf: [
  { type: "string", format: "uri", pattern: "^https://" },
  { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, fallbacks: { type: "array", maxItems: 1, items: { type: "string", format: "uri" } } }, additionalProperties: false },
] };
export const EXECUTE_SCHEMA = {
  type: "object", properties: {
    intent: { oneOf: [{ type: "string", maxLength: 3000 }, { type: "object" }] },
    capability: { type: "string", enum: definitions.map(x => x.id) },
    url: { type: "string", format: "uri" }, urls: { type: "array", maxItems: 3, items: { type: "string", format: "uri" } },
    sources: { type: "array", maxItems: 3, items: SOURCE_SCHEMA }, action: { type: "string" }, desired_action: { type: "string" },
    html: { type: "string", maxLength: 12288 }, limit: { type: "integer", minimum: 1, maximum: 30 },
    max_age_seconds: { type: "integer", minimum: 0, maximum: 60, default: 0 },
    query: { type: "string", maxLength: 200 }, testnet: { type: "boolean", default: false },
    input: { type: "object" }, arguments: { oneOf: [{ type: "object" }, { type: "string", description: "JSON-encoded object, as used by tool calls" }] }, name: { type: "string" }, tool: { type: "string" },
    tool_id: { type: "string" }, toolId: { type: "string" },
    function: { type: "object", required: ["name", "arguments"], properties: { name: { type: "string" }, arguments: { type: ["string", "object"] } }, additionalProperties: false },
    type: { const: "function" },
    quantity: { const: 1 }, units: { const: 1 }, requests: { const: 1 }, calls: { const: 1 },
    network: { type: "string", enum: ["eip155:8453", "eip155:84532", "base", "base-sepolia"] },
    operation: { type: "object", description: "Resolved read-only OpenAPI operation with URL, method and desired action; no remote spec fetching." },
    http: { type: "object" }, command: { type: "string" }, task: { type: "object" },
  }, additionalProperties: false,
  description: "Use intent:'demo' for a free result. Paid outcomes accept supported English/Arabic intents with public sources. Unknown jobs return repair guidance; this is not a general-purpose language model.",
};
export const RESULT_SCHEMA = { type: "object", required: ["ok", "intent", "capability", "result", "verification", "cost", "receipt"], properties: {
  ok: { const: true }, intent: { type: "object" }, capability: { type: "string" }, result: { type: "object" },
  verification: { type: "object" }, cost: { type: "object" }, receipt: { type: ["object", "null"] },
} };

export function outcomeDefinition(id) { return definitions.find(x => x.id === id) || null; }
export function outcomeAmount(env, id) {
  const item = outcomeDefinition(id);
  return item ? String(item.priceEnv ? env?.[item.priceEnv] || item.amount : "0") : null;
}
export function publicOutcome(item, env) {
  const amount = outcomeAmount(env, item.id);
  return {
    id: item.id, name: item.name, description: item.description, when_to_use: item.when_to_use,
    input_schema: { ...EXECUTE_SCHEMA, examples: [item.example] }, output_schema: RESULT_SCHEMA,
    pricing: { amount_atomic: amount, amount: (Number(amount) / 1e6).toFixed(6), currency: "USDC", decimals: 6,
      unit: "bounded execution", exact: true, includes_fallback: true, delivered: item.delivery,
      payment: amount === "0" ? null : "x402 v2; funded payer required, no XGuard account", quote_expires_seconds: amount === "0" ? null : 300 },
    availability: "live", execute_url: `${OUTCOME_API}/v1/execute`, protocols: ["http", "mcp", "a2a"],
    expected_latency_ms: null, latency_note: "Not yet measured in production; bounded source timeouts, no SLA.",
    limitations: item.limitations, example: item.example,
    url: `${OUTCOME_SITE}/capabilities/${item.id}`, schema_url: `${OUTCOME_API}/v1/capabilities/${item.id}`,
    mappings: { mcp: { endpoint: `${OUTCOME_API}/mcp`, tool: "xguard_execute" }, a2a: { endpoint: `${OUTCOME_API}/a2a`, skill: item.id }, openapi: { url: `${OUTCOME_API}/openapi.json`, operationId: "xguardExecute" } },
  };
}
export function outcomeDefinitions() { return definitions; }

function invalid(code, message, missing = [], suggested = { intent: "demo" }) {
  return { ok: false, error: code, message, repair: { missing, suggested_request: suggested },
    available: false, closest_capabilities: definitions.map(({ id, description }) => ({ id, description })),
    request_capability: `${OUTCOME_API}/v1/capabilities` };
}
function publicUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.port && u.port !== "443" || u.username || u.password || u.hash || !hostnameAllowed(u.hostname) || u.hostname.split(".").some(x => x.startsWith("xn--"))) return null;
    return u.toString();
  } catch { return null; }
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b)); }

export function outcomeRequest(input, testnet = false) {
  if (input.capability === "extract-preview") return { capability: input.capability, ...(input.html !== null ? { html: input.html } : {}) };
  return { capability: input.capability, sources: input.sources, max_age_seconds: input.max_age_seconds,
    ...(input.capability === "feed-digest" ? { limit: input.limit, query: input.query } : {}), testnet };
}

// Dispatch by explicit semantics before selecting the legacy web.fetch handler.
export function isOutcomeRequest(raw, depth = 0) {
  if (depth > 4 || raw == null) return false;
  if (typeof raw === "string") { try { return isOutcomeRequest(JSON.parse(raw), depth + 1); } catch { return true; } }
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  if (raw.intent !== undefined || raw.capability !== undefined && !["xguard.web.fetch", "web.fetch", "fetch", "xguard_web_fetch"].includes(raw.capability)) return true;
  if ([raw.tool, raw.tool_id, raw.toolId, raw.name, raw.function?.name].some(x => ["execute", "xguard_execute", "xguardExecute"].includes(x) || outcomeDefinition(String(x).replace(/^xguard\./, "")))) return true;
  return [raw.input, raw.arguments, raw.function?.arguments].some(x => x !== undefined && isOutcomeRequest(x, depth + 1));
}

export function normalizeOutcome(raw, depth = 0) {
  if (depth > 4) return invalid("invalid_intent", "Too many nested request envelopes.");
  if (typeof raw === "string") raw = { intent: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("invalid_intent", "Send an object containing intent, or a supported intent string.", ["intent"]);
  raw = { ...raw };
  const quantity = ["quantity", "units", "requests", "calls"].filter(key => Object.hasOwn(raw, key));
  if (quantity.some(key => raw[key] !== raw[quantity[0]])) return invalid("ambiguous_intent", "Quantity aliases conflict; one request is one bounded execution.", quantity);
  if (quantity.some(key => raw[key] !== 1)) return invalid("unsupported_quantity", "Only quantity:1 is supported. The published price includes one bounded execution.", quantity);
  for (const key of quantity) delete raw[key];
  if (raw.network !== undefined) {
    const networks = { "eip155:8453": false, "base": false, "eip155:84532": true, "base-sepolia": true };
    if (typeof raw.network !== "string" || !Object.hasOwn(networks, raw.network)) return invalid("invalid_intent", "Select the documented Base or Base Sepolia network.", ["network"]);
    if (raw.testnet !== undefined && raw.testnet !== networks[raw.network]) return invalid("ambiguous_intent", "network and testnet must select the same network.", ["network", "testnet"]);
    raw.testnet = networks[raw.network]; delete raw.network;
  }
  if (raw.function !== undefined) {
    if (!raw.function || typeof raw.function !== "object" || Array.isArray(raw.function) || !Object.hasOwn(raw.function, "name") || !Object.hasOwn(raw.function, "arguments") || Object.keys(raw.function).some(key => !["name", "arguments"].includes(key))) return invalid("invalid_intent", "function must contain name and arguments only.");
    if (raw.name !== undefined && raw.name !== raw.function.name) return invalid("ambiguous_intent", "Conflicting tool names.");
    if (raw.arguments !== undefined && !same(raw.arguments, raw.function.arguments)) return invalid("ambiguous_intent", "Conflicting function arguments.");
    raw.name = raw.function.name; raw.arguments = raw.function.arguments; delete raw.function;
  }
  if (raw.type !== undefined && raw.type !== "function") return invalid("unsupported_operation", "Only the function tool-call type is supported.");
  delete raw.type;
  const selectors = ["tool", "tool_id", "toolId", "name"].filter(key => Object.hasOwn(raw, key));
  const selected = selectors.map(key => ["execute", "xguard_execute", "xguardExecute"].includes(raw[key]) ? "xguard_execute" : String(raw[key]).replace(/^xguard\./, ""));
  if (selected.some(x => x !== selected[0])) return invalid("ambiguous_intent", "Tool aliases contain different values.", selectors);
  if (selected.length && selected[0] !== "xguard_execute") {
    if (!outcomeDefinition(selected[0])) return invalid("unsupported_operation", "Select an available capability or xguard_execute.", selectors);
    if (raw.capability !== undefined && raw.capability !== selected[0]) return invalid("ambiguous_intent", "tool and capability select different outcomes.", ["tool", "capability"]);
    raw.capability = selected[0];
  }
  for (const key of selectors) delete raw[key];
  if (typeof raw.arguments === "string") {
    const parsed = parsePublicJson(raw.arguments);
    if (parsed.error) return invalid(parsed.error, "arguments must contain a complete JSON object with no duplicate properties.", ["arguments"]);
    raw.arguments = parsed.value;
  }
  if (raw.desired_action !== undefined) {
    if (raw.action !== undefined && raw.action !== raw.desired_action) return invalid("ambiguous_intent", "Conflicting desired actions.");
    raw = { ...raw, action: raw.desired_action }; delete raw.desired_action;
  }
  const supportedKeys = new Set([...Object.keys(EXECUTE_SCHEMA.properties), "method", "headers", "body", "body_json", "body_text", "body_base64", "operationId"]);
  const unknown = Object.keys(raw).filter(key => !supportedKeys.has(key));
  if (unknown.length) return invalid("unsupported_operation", "This outcome does not support every supplied field; inspect its input schema before retrying.", unknown);
  if (raw.operationId && !["xguardExecute", "xguard_execute", ...definitions.map(x => x.id)].includes(raw.operationId)) return invalid("unsupported_operation", "Provide a supported operation with a resolved public URL and extraction action.");
  if (raw.testnet !== undefined && typeof raw.testnet !== "boolean") return invalid("invalid_intent", "testnet must be true or false.");
  const envelopes = [raw.input, raw.arguments, raw.operation, raw.http, typeof raw.intent === "object" ? raw.intent : null].filter(x => x !== undefined && x !== null);
  if (raw.headers && Object.keys(raw.headers).length || ["body", "body_json", "body_text", "body_base64"].some(x => raw[x] !== undefined) || raw.method && (typeof raw.method !== "string" || raw.method.toUpperCase() !== "GET")) return invalid("unsupported_operation", "These outcomes read public sources without credentials. Use the scoped egress contract for authorized requests.");
  if (envelopes.length > 1) return invalid("ambiguous_intent", "Use one request envelope, not several conflicting shapes.");
  if (envelopes.length) {
    if (raw.command !== undefined || raw.task !== undefined) return invalid("ambiguous_intent", "Use one request envelope without a separate command or task.");
    const inside = envelopes[0];
    if (!inside || typeof inside !== "object" || Array.isArray(inside)) return invalid("invalid_intent", "The request envelope must contain an object.");
    const merged = { ...inside };
    for (const key of ["capability", "sources", "urls", "url", "html", "action", "limit", "max_age_seconds", "query", "testnet"]) {
      if (raw[key] !== undefined && inside[key] !== undefined && !same(raw[key], inside[key])) return invalid("ambiguous_intent", `Conflicting ${key} values.`);
      if (raw[key] !== undefined) merged[key] = raw[key];
    }
    if (typeof raw.intent === "string") {
      if (inside.intent !== undefined && inside.intent !== raw.intent) return invalid("ambiguous_intent", "Conflicting intent values.", ["intent"]);
      merged.intent = raw.intent;
    }
    if (raw.operation?.operationId && !["xguardExecute", "xguard_execute", ...definitions.map(x => x.id)].includes(raw.operation.operationId)) return invalid("unsupported_operation", "Resolve the OpenAPI operation to a public GET URL and desired extraction action, or use xguardExecute.");
    return normalizeOutcome(merged, depth + 1);
  }
  if (raw.task) {
    if (Object.keys(raw).some(key => key !== "task")) return invalid("ambiguous_intent", "Send a task envelope without additional instructions.");
    const message = raw.task.message || raw.task;
    const parts = message.parts;
    if (!Array.isArray(parts) || parts.length !== 1) return invalid("invalid_intent", "Send one A2A data or text part.");
    return normalizeOutcome(parts[0].data ?? parts[0].text, depth + 1);
  }
  if (raw.headers && Object.keys(raw.headers).length || ["body", "body_json", "body_text", "body_base64"].some(x => raw[x] !== undefined) || raw.method && (typeof raw.method !== "string" || raw.method.toUpperCase() !== "GET")) return invalid("unsupported_operation", "These outcomes read public sources without credentials. Credential-backed writes use the existing scoped /v1/egress/fetch contract.");
  const command = raw.command || (typeof raw.intent === "string" && raw.intent.trim().startsWith("curl ") ? raw.intent : null);
  if (command) {
    if (Object.keys(raw).some(key => !["command", "intent", "testnet"].includes(key)) || raw.command && raw.intent !== undefined && raw.intent !== raw.command) return invalid("ambiguous_intent", "A curl envelope must not override other supplied instructions.");
    const match = String(command).trim().match(/^curl\s+(?:(?:-X|--request)\s+GET\s+)?['"]?(https:\/\/[^\s'"`$]+)['"]?\s*$/);
    if (!match) return invalid("unsupported_operation", "Only a single credential-free GET curl URL is supported. Commands are never executed.");
    return normalizeOutcome({ intent: "extract page", url: match[1], testnet: raw.testnet ?? false }, depth + 1);
  }
  const text = String(raw.intent || raw.action || "").trim();
  if (text.length > 3000) return invalid("invalid_intent", "Intent exceeds 3000 characters.");
  let capability = raw.capability;
  if (!capability) {
    if (/^(demo|preview|try|تجربة|تجربه|معاينة)$/i.test(text) || raw.html !== undefined) capability = "extract-preview";
    else if (/\b(feeds?|rss|atom|digest|headlines)\b|خلاص[ةات]|أخبار|اخبار/i.test(text)) capability = "feed-digest";
    else if (/\b(product|offers?|price|prices)\b|منتج|أسعار|اسعار|سعر|عروض/i.test(text)) capability = "product-offers";
    else if (/\b(extract|extraction|pages?|evidence|fetch|read)\b|استخراج|استخرج|صفحات|صفحة|اقرأ/i.test(text)) capability = "web-extraction";
    else if (!text && (raw.url || raw.urls || raw.sources)) return invalid("invalid_intent", "Describe the desired outcome: extract pages, compare product offers, or merge feeds.", ["intent"], { intent: "Extract these pages", ...(raw.url ? { url: raw.url } : { sources: raw.sources || raw.urls }) });
  }
  if (!outcomeDefinition(capability)) return invalid("capability_unavailable", "No executable capability matches this intent. Select one of the available outcomes.", ["supported intent"]);
  if (capability !== "feed-digest" && (raw.query !== undefined || raw.limit !== undefined)) return invalid("unsupported_operation", "query and limit apply to feed-digest only.");
  if (capability === "extract-preview") {
    if (raw.url || raw.urls || raw.sources) return invalid("invalid_intent", "The free preview processes supplied HTML. Use web-extraction for live URLs.", ["html"], { intent: "Extract this page", url: raw.url || raw.urls?.[0] || "https://example.com/" });
    if (raw.html !== undefined && (typeof raw.html !== "string" || new TextEncoder().encode(raw.html).length > 12288)) return invalid("invalid_intent", "html must be a string of at most 12 KiB.");
    return { ok: true, input: { v: 1, capability, html: raw.html ?? null }, testnet: false };
  }
  if ([raw.sources, raw.urls, raw.url].filter(x => x !== undefined).length > 1) return invalid("ambiguous_intent", "Supply only one of sources, urls or url.");
  const inline = text.match(/https:\/\/[^\s<>"']+/g)?.map(x => x.replace(/[),;،]+$/, ""));
  let sources = raw.sources ?? raw.urls ?? (raw.url ? [raw.url] : inline);
  if (!sources && capability === "feed-digest") sources = structuredClone(DEFAULT_FEEDS);
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 3) return invalid("invalid_intent", "Provide between one and three public source URLs. XGuard does not perform web-wide search.", ["sources"], { capability, sources: ["https://example.com/"] });
  const normalized = [];
  for (const source of sources) {
    const item = typeof source === "string" ? { url: source } : source;
    if (item && typeof item === "object" && Object.keys(item).some(key => !["url", "fallbacks"].includes(key))) return invalid("unsupported_operation", "Each source supports only url and fallbacks.");
    const url = publicUrl(item?.url);
    if (!url || item.fallbacks !== undefined && (!Array.isArray(item.fallbacks) || item.fallbacks.length > 1)) return invalid("target_not_public", "Sources require public HTTPS/443 URLs without credentials, fragments or internationalized hostnames; at most one backup per source.");
    const fallbacks = (item.fallbacks || []).map(publicUrl);
    if (fallbacks.some(x => !x)) return invalid("target_not_public", "A fallback URL violates the public-source policy.");
    if (!normalized.some(x => x.url === url)) normalized.push({ url, fallbacks: [...new Set(fallbacks.filter(x => x !== url))] });
  }
  const limit = raw.limit ?? 10;
  const maxAge = raw.max_age_seconds ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30 || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > 60) return invalid("invalid_intent", "limit must be 1–30 and max_age_seconds must be 0–60.");
  if (raw.query !== undefined && (typeof raw.query !== "string" || raw.query.length > 200)) return invalid("invalid_intent", "query must be a string of at most 200 characters.");
  if (capability === "product-offers" && maxAge !== 0) return invalid("invalid_intent", "Product offers require max_age_seconds:0 so a cached price is not represented as fresh.");
  return { ok: true, testnet: raw.testnet ?? false, input: { v: 1, capability, sources: normalized, limit,
    query: raw.query || "", max_age_seconds: maxAge, timeout_ms: 8000, max_bytes: 131072 } };
}
