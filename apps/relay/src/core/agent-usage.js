import { digestBytes } from "./execution-contract.js";

export const AGENT_USAGE_PATH = "/v1/agent-token-usage/summary";
export const AGENT_USAGE_VERSION = "1.0.0";
export const MAX_USAGE_BYTES = 16 * 1024;
export const MAX_USAGE_TOKENS = 1_000_000_000;
export const USAGE_RATE_LIMIT = 120;
export const TENANT_ALIASES = ["tenantId", "tenant_id", "organizationId", "organization_id", "orgId", "org_id"];
const TOKEN_ALIASES = {
  input_tokens: ["inputTokens", "input_tokens", "prompt_tokens", "promptTokens"],
  output_tokens: ["outputTokens", "output_tokens", "completion_tokens", "completionTokens"],
  total_tokens: ["totalTokens", "total_tokens"],
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

export class UsageError extends Error {
  constructor(code, status, message, retryable = false) {
    super(message); this.code = code; this.status = status; this.retryable = retryable;
  }
}
function reject(code, message) { throw new UsageError(code, 400, message); }

function oneValue(values, name) {
  if (values.length && values.some(value => value !== values[0])) reject("conflicting_aliases", `Conflicting values for ${name}.`);
  return values[0];
}
function textField(value, name) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.length || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    reject("invalid_usage_metadata", `${name} must be a nonempty string of at most 128 characters without control characters.`);
  }
  return value;
}

export function validateUsageRecord(record) {
  if (!object(record) || !object(record.usage)) reject("invalid_usage", "Send a JSON object containing token counts.");
  const { input_tokens: input, output_tokens: output, total_tokens: total } = record.usage;
  for (const [name, value] of Object.entries({ input_tokens: input, output_tokens: output, total_tokens: total })) {
    if (value === null && name !== "total_tokens") continue;
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) {
      reject("invalid_token_count", `${name} must be an integer between 0 and ${MAX_USAGE_TOKENS}.`);
    }
  }
  if (total < (input ?? 0) + (output ?? 0)) reject("inconsistent_token_total", "total_tokens must be at least the sum of the supplied input and output counts.");
  for (const field of ["model", "agent"]) if (record[field] !== null) textField(record[field], field);
  return record;
}

export function normalizeAgentUsagePayload(body) {
  if (!object(body)) reject("invalid_usage", "Send one JSON object, not an array or scalar.");
  if (own(body, "usage") && !object(body.usage)) reject("invalid_usage", "usage must be a JSON object.");
  const sources = body.usage ? [body, body.usage] : [body];
  const counts = {};
  for (const [name, aliases] of Object.entries(TOKEN_ALIASES)) {
    const values = sources.flatMap(source => aliases.filter(key => own(source, key)).map(key => source[key]));
    // Explicit null, strings, booleans and non-finite numbers are not missing counts.
    for (const value of values) if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) reject("invalid_token_count", `${name} must be an integer between 0 and ${MAX_USAGE_TOKENS}.`);
    counts[name] = oneValue(values, name);
  }
  if (Object.values(counts).every(value => value === undefined)) reject("usage_tokens_required", "Supply input, output, or total token counts.");
  return validateUsageRecord({ usage: {
    input_tokens: counts.input_tokens ?? null,
    output_tokens: counts.output_tokens ?? null,
    total_tokens: counts.total_tokens ?? (counts.input_tokens ?? 0) + (counts.output_tokens ?? 0),
  }, model: textField(body.model, "model"), agent: textField(body.agent, "agent") });
}

export function requestedUsageTenant(url, body) {
  const values = TENANT_ALIASES.flatMap(key => [...url.searchParams.getAll(key), ...(own(body, key) ? [body[key]] : [])]);
  for (const value of values) if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) reject("invalid_tenant_identifier", "Tenant identifiers must contain 1–128 letters, digits, dots, colons, underscores or hyphens.");
  return oneValue(values, "tenant") ?? null;
}

// Identity comes only from a successfully authenticated billing operator key.
// External organization IDs require a server-managed binding, never first-use registration.
export function resolveUsageTenant(requested, authenticatedKeyHash, bindingsJson) {
  if (!/^[a-f0-9]{64}$/.test(authenticatedKeyHash || "")) throw new UsageError("tenant_identity_required", 401, "A trusted tenant identity is required before usage can be recorded.");
  let bindings;
  try { bindings = JSON.parse(bindingsJson || "{}"); } catch { bindings = null; }
  if (!object(bindings) || Object.entries(bindings).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))) {
    throw new UsageError("usage_identity_configuration_invalid", 503, "Trusted tenant bindings are unavailable.", true);
  }
  const tenant = own(bindings, authenticatedKeyHash) ? bindings[authenticatedKeyHash] : `xgt_${authenticatedKeyHash}`;
  if (requested !== null && requested !== tenant) throw new UsageError("tenant_mismatch", 403, "The requested tenant is not bound to the authenticated operator key.");
  return tenant;
}

export async function usageEventKeys(request, body) {
  const bodyValues = ["requestId", "request_id"].filter(key => own(body, key)).map(key => body[key]);
  const bodyId = oneValue(bodyValues, "request ID");
  const headerId = request.headers.get("idempotency-key");
  const keys = [headerId, bodyId].filter(value => value !== null && value !== undefined);
  if (!keys.length && request.headers.has("x-request-id")) keys.push(request.headers.get("x-request-id"));
  if (!keys.length) reject("idempotency_key_required", "Supply Idempotency-Key, requestId, request_id, or X-Request-ID and reuse it when retrying this event.");
  for (const key of keys) if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(key)) reject("invalid_idempotency_key", "Event identifiers must contain 1–200 ASCII letters, digits, or . _ : @ / -.");
  // When a stable event key is present, X-Request-ID is only a transport trace.
  return Promise.all([...new Set(keys)].map(key => digestBytes(key)));
}

export function buildUsageResponse(event, duplicate) {
  return { ok: true, accepted: true, usage: event.usage, tenant: event.tenant, request_id: event.request_id, duplicate };
}

// Uses a constant key per Durable Object instead of accumulating time-bucket keys.
export async function admitUsage(storage, now = Date.now()) {
  return storage.transaction(async txn => {
    const bucket = Math.floor(now / 60000);
    let rate = await txn.get("agent-usage:rate");
    if (rate?.bucket !== bucket) rate = { bucket, count: 0 };
    if (rate.count >= USAGE_RATE_LIMIT) return { allowed: false, retry_after_seconds: Math.ceil((60000 - now % 60000) / 1000) };
    rate.count += 1;
    await txn.put("agent-usage:rate", rate);
    return { allowed: true };
  });
}

// Event records, all event aliases, and monthly counts commit together. No billing
// credits, paid-execution counters, or global EgressMeter statistics are changed.
export async function recordUsage(storage, event, now = Date.now()) {
  validateUsageRecord(event);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(event.tenant || "") || !/^xgr_[a-f0-9]{32}$/.test(event.request_id || "") ||
    !Array.isArray(event.keys) || !event.keys.length || event.keys.length > 2 || event.keys.some(key => !/^[a-f0-9]{64}$/.test(key))) reject("invalid_usage_event", "Invalid canonical usage event.");
  const fingerprint = await digestBytes(JSON.stringify({ tenant: event.tenant, usage: event.usage, model: event.model, agent: event.agent }));
  return storage.transaction(async txn => {
    const storedTenant = await txn.get("agent-usage:tenant");
    if (storedTenant && storedTenant !== event.tenant) throw new UsageError("tenant_mismatch", 403, "Usage storage belongs to another tenant.");
    const prior = [];
    for (const key of event.keys) { const value = await txn.get(`agent-usage:event:${key}`); if (value) prior.push(value); }
    if (prior.some(value => value.fingerprint !== fingerprint || value.request_id !== prior[0].request_id)) {
      throw new UsageError("idempotency_conflict", 409, "This event identifier was already used for a different event. Reuse the original payload or use a new identifier for a new event.");
    }
    if (prior.length) {
      for (const key of event.keys) await txn.put(`agent-usage:event:${key}`, prior[0]);
      return buildUsageResponse(prior[0], true);
    }
    const month = new Date(now).toISOString().slice(0, 7);
    const aggregateKey = `agent-usage:month:${month}`;
    const aggregate = await txn.get(aggregateKey) || { events: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, incomplete_breakdowns: 0 };
    aggregate.events += 1;
    for (const name of ["input_tokens", "output_tokens", "total_tokens"]) aggregate[name] += event.usage[name] ?? 0;
    if (event.usage.input_tokens === null || event.usage.output_tokens === null) aggregate.incomplete_breakdowns += 1;
    if (Object.values(aggregate).some(value => !Number.isSafeInteger(value))) throw new UsageError("usage_aggregate_overflow", 503, "Usage aggregate capacity exceeded.");
    const stored = { tenant: event.tenant, request_id: event.request_id, usage: event.usage, model: event.model, agent: event.agent, fingerprint, recorded_at: new Date(now).toISOString() };
    await txn.put("agent-usage:tenant", event.tenant);
    for (const key of event.keys) await txn.put(`agent-usage:event:${key}`, stored);
    await txn.put(aggregateKey, aggregate);
    return buildUsageResponse(stored, false);
  });
}
