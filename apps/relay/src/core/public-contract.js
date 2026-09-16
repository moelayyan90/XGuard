import { readBoundedBody } from "./execution-contract.js";

const API = "https://api.xguardgate.com";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function hasDuplicateKeys(text) {
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^{}\[\],:\s]+/g)) {
    const token = match[0];
    if (token === "{") stack.push({ keys: new Set(), key: true });
    else if (token === "[") stack.push({ key: false });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && stack.at(-1)?.keys) stack.at(-1).key = true;
    else if (token.startsWith('"') && stack.at(-1)?.key) {
      const frame = stack.at(-1), key = JSON.parse(token);
      if (frame.keys.has(key)) return true;
      frame.keys.add(key); frame.key = false;
    }
  }
  return false;
}

export function parsePublicJson(text) {
  try {
    const value = JSON.parse(text);
    return hasDuplicateKeys(text) ? { error: "duplicate_json_key" } : { value };
  } catch { return { error: "invalid_json" }; }
}

// Parse bytes before business validation. Never repair signatures or guess JSON.
export async function readPublicJson(request, maxBytes = 16384) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return { error: "payload_too_large" };
  let bytes;
  try { bytes = await readBoundedBody(request.body, maxBytes); }
  catch (cause) { return { error: cause.message === "response_too_large" ? "payload_too_large" : "body_read_failed" }; }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { error: "invalid_utf8" }; }
  if (!text.trim()) return { error: "empty_body" };
  try {
    const parsed = parsePublicJson(text);
    if (parsed.error) return parsed;
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json" && !contentType.endsWith("+json")) {
      logNormalization(request, ["json_content_type"]);
    }
    return parsed;
  } catch { return { error: "invalid_json" }; }
}

export function logNormalization(request, changes) {
  if (changes?.length) console.info(JSON.stringify({ event: "input_normalized", path: new URL(request.url).pathname,
    types: [...new Set(changes)], traffic_class: request.headers.get("x-xguard-traffic-class") === "synthetic" ? "synthetic" : "unclassified" }));
}

export function publicRequestId(request, response, value) {
  for (const id of [value?.request_id, response?.headers.get("x-xguard-request-id"), request.headers.get("x-request-id")]) {
    if (typeof id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(id)) return id;
  }
  return `xgr_${crypto.randomUUID().replaceAll("-", "")}`;
}

const messages = {
  empty_body: "The request body is empty. Send a complete JSON object using the example.",
  invalid_json: "The request body is malformed or incomplete JSON. Resend the complete JSON document.",
  invalid_utf8: "The request body is not valid UTF-8. Encode the complete JSON document as UTF-8.",
  body_read_failed: "The request body could not be read completely. Resend the complete document.",
  duplicate_json_key: "The JSON document repeats a property name. Send each field once; duplicate payment or tool fields are not safe to infer.",
  payload_too_large: "The request body exceeds this endpoint's byte limit.",
  body_too_large: "The request body exceeds this endpoint's byte limit.",
  missing_payment_context: "Send the full signed x402 paymentPayload and the selected paymentRequirements on this request. A prior verify response grants no trust.",
  conflicting_payment_context: "Payment aliases contain different values. Send one canonical paymentPayload and paymentRequirements; do not change the signed values.",
};

export function requestExample(path) {
  if (["/verify", "/settle"].includes(path)) {
    const requirements = { scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "<recipient from selected requirement>", amount: "<exact atomic amount>", maxTimeoutSeconds: 300 };
    return { x402Version: 2, paymentRequirements: requirements, paymentPayload: { x402Version: 2, accepted: requirements,
      payload: { signature: "<original signature>", authorization: { from: "<payer>", to: requirements.payTo, value: requirements.amount,
        nonce: "<original nonce>", validAfter: "<original validAfter>", validBefore: "<original validBefore>" } } } };
  }
  if (path.startsWith("/v1/tools/") || path === "/v1/preflight") return { url: "https://example.com/" };
  if (path === "/v1/pricing/quote") return { capability: "feed-digest" };
  if (path === "/v1/proofs/verify") return { proof: "<original compact signed proof>" };
  if (path === "/v1/execute") return { intent: "demo" };
  return undefined;
}

export function publicError(value, request, status, id) {
  const path = new URL(request.url).pathname;
  const prior = object(value.error) ? value.error : {};
  const code = String(value.reason || prior.code || value.error_code || value.errorReason || value.invalidReason || value.error || "request_failed");
  const issue = prior.details?.issues?.[0];
  const example = requestExample(path);
  const payment = ["/verify", "/settle"].includes(path);
  const uncertain = /ambiguous|pending|in_progress|reconciliation/.test(code);
  const retryable = uncertain ? false : Boolean(prior.retryable ?? (status === 429));
  const next = uncertain ? { method: "GET", path: "/openapi.json", action: "reconcile_before_retry", payment_required: false }
    : payment ? { method: "POST", path, action: "resend_complete_original_payment_context", payment_required: false }
    : status === 401 || status === 403 || !example ? { method: "GET", path: "/openapi.json", action: "inspect_endpoint_requirements", payment_required: false }
    : { method: "POST", path, action: "repair_request_before_retry", example_request: example, payment_required: false };
  return { ...value, ok: false, error_code: code, request_id: id,
    error: { ...prior, code, message: messages[code] || prior.message || value.message || issue?.message || `Request rejected: ${code}. Inspect the endpoint requirements.`,
      ...(issue?.path || value.detail?.field ? { field: issue?.path || value.detail.field } : {}),
      ...(value.detail?.missing_fields ? { required_fields: value.detail.missing_fields } : {}),
      ...(example ? { example } : {}), docs: `${API}/openapi.json`, retryable },
    next: value.next || next };
}

// Keep native x402 and JSON-RPC wire contracts. REST callers get one error type;
// protocol-specific fields (reason/errorReason/invalidReason) remain available.
export async function finalizePublicResponse(request, response) {
  const headers = new Headers(response.headers);
  const isJson = /(?:application\/json|\+json)/i.test(headers.get("content-type") || "");
  if (!isJson || request.method === "HEAD" || response.status === 204) return response;
  const value = await response.clone().json().catch(() => null);
  if (!object(value) || value.jsonrpc === "2.0" || new URL(request.url).pathname.startsWith("/.well-known/oauth-")) return response;
  const id = publicRequestId(request, response, value);
  headers.set("x-xguard-request-id", id);
  if (response.ok) {
    if (new URL(request.url).pathname === "/openapi.json") {
      describePublicContract(value);
      headers.delete("content-length");
      return new Response(JSON.stringify(value), { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  }
  const problem = publicError(value, request, response.status, id);
  const body = value.x402Version === 2 && Array.isArray(value.accepts)
    ? { ...value, request_id: id, xguard_error: problem.error } : problem;
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

function describePublicContract(spec) {
  spec.components ||= {}; spec.components.schemas ||= {};
  spec.components.schemas.PublicError = { type: "object", required: ["ok", "error", "error_code", "request_id", "next"], properties: {
    ok: { const: false }, error_code: { type: "string" }, request_id: { type: "string" }, next: { type: "object" },
    error: { type: "object", required: ["code", "message", "retryable", "docs"], properties: {
      code: { type: "string" }, message: { type: "string" }, field: { type: "string" }, required_fields: { type: "array", items: { type: "string" } },
      retryable: { type: "boolean" }, docs: { type: "string", format: "uri" }, example: { type: "object" },
    } },
  } };
  const content = { "application/json": { schema: { $ref: "#/components/schemas/PublicError" } } };
  for (const [path, codes] of Object.entries({
    "/v1/execute": [400, 409, 413, 500], "/v1/pricing/quote": [400, 413, 429, 500],
    "/verify": [400, 413, 429, 503], "/settle": [400, 409, 413, 429, 503],
  })) {
    const operation = spec.paths?.[path]?.post;
    if (!operation) continue;
    for (const code of codes) operation.responses[code] ||= { description: "Request rejected with repair instructions; no automatic retry of ambiguous settlement." };
    for (const [code, response] of Object.entries(operation.responses)) if (Number(code) >= 400 && code !== "402") response.content = content;
  }
  for (const path of ["/agent-card.json", "/openapi.yaml", "/pricing"]) spec.paths[path] = { get: { summary: "Canonical discovery alias", responses: { "308": { description: "Follow Location to the canonical representation" } } } };
  spec.paths["/.well-known/agent-directory.json"] = { get: { summary: "Discover the canonical XGuard agent card and tool catalog", responses: { "200": { description: "XGuard discovery links" } } } };
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) spec.paths[path] = { get: { summary: "Resource metadata; public x402 tools do not require OAuth", responses: { "200": { description: "Resource URL and truthful authentication capabilities" } } } };
  const quote = spec.paths?.["/v1/pricing/quote"]?.post;
  if (quote) {
    quote.summary = "Quote a live outcome or the compatible web.fetch tool";
    quote.description = "Free. Send capability:feed-digest for the smallest paid-outcome quote. Tool aliases and JSON-encoded function arguments are accepted only when unambiguous. Quantity is one bounded execution. next.body is directly executable with the returned quote header. Testnet must match the requested network.";
    quote.requestBody.content["application/json"].example = { capability: "feed-digest" };
  }
  for (const path of ["/verify", "/settle"]) {
    const operation = spec.paths?.[path]?.post;
    if (operation) operation.description = "Send the full x402 v2 paymentPayload and paymentRequirements on each request. payment_payload/payment and payment_requirements/requirements are accepted aliases; an encoded Payment-Signature value may supply the payload. Conflicting aliases are rejected. A prior verification response or client trust flag cannot authorize settlement.";
  }
}
