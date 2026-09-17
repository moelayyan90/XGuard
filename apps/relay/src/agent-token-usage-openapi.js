import { AGENT_USAGE_PATH, AGENT_USAGE_VERSION, MAX_USAGE_BYTES, MAX_USAGE_TOKENS, TENANT_ALIASES } from "./core/agent-usage.js";

export function describeAgentUsage(spec) {
  spec.components ||= {}; spec.components.schemas ||= {}; spec.components.securitySchemes ||= {};
  spec.components.securitySchemes.UsageOperatorBearer = { type: "http", scheme: "bearer", description: "A provisioned, unrestricted XGuard billing operator key. No credit balance is consumed or required." };
  spec.components.securitySchemes.UsageOperatorKey = { type: "apiKey", in: "header", name: "X-XGuard-Key", description: "The same provisioned operator key. If both authentication headers are present they must agree." };
  const token = { type: "integer", minimum: 0, maximum: MAX_USAGE_TOKENS };
  const countNames = ["inputTokens", "input_tokens", "prompt_tokens", "promptTokens", "outputTokens", "output_tokens", "completion_tokens", "completionTokens", "totalTokens", "total_tokens"];
  const counts = Object.fromEntries(countNames.map(name => [name, token]));
  const tenant = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$", maxLength: 128 };
  const eventId = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$", maxLength: 200 };
  const countRequired = countNames.map(name => ({ required: [name] }));
  const input = { type: "object", additionalProperties: true,
    description: "At least one token count is required, at the root or under usage. All aliases must agree. Unknown fields are ignored and never stored. Counts must be JSON numbers; total must be at least the sum of the supplied components. Missing total is computed from supplied components. Missing input/output remain null in the response.",
    properties: { ...counts, ...Object.fromEntries(TENANT_ALIASES.map(name => [name, tenant])),
      usage: { type: "object", additionalProperties: true, properties: counts },
      model: { type: "string", minLength: 1, maxLength: 128, pattern: "^[^\\u0000-\\u001f\\u007f]+$" },
      agent: { type: "string", minLength: 1, maxLength: 128, pattern: "^[^\\u0000-\\u001f\\u007f]+$" },
      requestId: eventId, request_id: eventId },
    anyOf: [...countRequired, { required: ["usage"], properties: { usage: { anyOf: countRequired } } }] };
  const success = { type: "object", required: ["ok", "accepted", "usage", "tenant", "request_id", "duplicate"], properties: {
    ok: { const: true }, accepted: { const: true }, tenant, request_id: { type: "string", pattern: "^xgr_[a-f0-9]{32}$" }, duplicate: { type: "boolean" },
    usage: { type: "object", required: ["input_tokens", "output_tokens", "total_tokens"], properties: {
      input_tokens: { anyOf: [token, { type: "null" }] }, output_tokens: { anyOf: [token, { type: "null" }] }, total_tokens: token } } } };
  spec.components.schemas.AgentUsageInput = input;
  spec.components.schemas.AgentUsageResponse = success;
  spec["x-xguard-agent-usage-contract-version"] = AGENT_USAGE_VERSION;
  spec.paths ||= {};
  const error = description => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/PublicError" } } } });
  spec.paths[AGENT_USAGE_PATH] = {
    post: {
      operationId: "recordAgentTokenUsage", tags: ["Usage accounting"], summary: "Record a tenant-bound agent token usage event",
      description: `Compatibility ingestion contract ${AGENT_USAGE_VERSION}; not a query endpoint or provider-verified invoice. Available on both https://xguardgate.com and https://api.xguardgate.com without redirecting POST. Maximum UTF-8 JSON body: ${MAX_USAGE_BYTES} bytes. Authentication checks the existing billing identity; this endpoint never charges credits or requests x402 payment. Tenant defaults to xgt_<SHA-256 of operator key>, or a server-configured organization binding. All supplied tenant aliases (query and body) must equal that identity. A client cannot register an organization. At least one event identifier is mandatory: Idempotency-Key and/or body requestId/request_id; X-Request-ID is the fallback only when neither is supplied. Both stable identifiers are indexed when supplied. Retries with matching canonical counts/model/agent replay the stored response with duplicate:true; changed data or identifiers linking two existing events return 409. Unknown fields do not affect the fingerprint. Event identifiers persist without TTL in existing durable storage; do not reuse them. Admission is limited to 120 requests/minute per source IP and authenticated tenant, including replays. On 429/503 retry with the same identifiers. Counts are self-reported telemetry and are never used to create paid usage or revenue.`,
      servers: [{ url: "https://api.xguardgate.com" }, { url: "https://xguardgate.com" }],
      security: [{ UsageOperatorBearer: [] }, { UsageOperatorKey: [] }],
      parameters: [
        ...TENANT_ALIASES.map(name => ({ name, in: "query", required: false, schema: tenant, description: "Optional assertion of the authenticated tenant; aliases must agree. Unbound IDs are rejected with 403." })),
        { name: "Idempotency-Key", in: "header", required: false, schema: eventId, description: "Stable event identifier. At least this, a body request ID, or X-Request-ID is required." },
        { name: "X-Request-ID", in: "header", required: false, schema: eventId, description: "Fallback event identifier only if neither Idempotency-Key nor a body request ID is supplied." },
      ],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AgentUsageInput" }, examples: {
        camelCase: { value: { inputTokens: 100, outputTokens: 50, totalTokens: 150, model: "model-name", agent: "agent-name", requestId: "event-001" } },
        snake_case: { value: { input_tokens: 100, output_tokens: 50, total_tokens: 150, request_id: "event-002" } },
        nested: { value: { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, requestId: "event-003" } },
        total_only: { value: { totalTokens: 150, requestId: "event-004" } },
      } } } },
      responses: {
        "200": { description: "Durably recorded or idempotently replayed; no payment charged.", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentUsageResponse" }, example: {
          ok: true, accepted: true, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, tenant: "org_example", request_id: "xgr_0123456789abcdef0123456789abcdef", duplicate: false } } } },
        "400": error("Invalid JSON, counts, identifiers, conflicting aliases, missing counts, or missing event identifier."),
        "401": error("Missing, invalid or unprovisioned operator identity."),
        "403": error("Tenant mismatch, restricted operator, or disallowed origin."),
        "405": error("Method not allowed. Use POST or OPTIONS."),
        "409": error("An event identifier conflicts with previously recorded usage."),
        "413": error("Body exceeds 16384 bytes, including undeclared/chunked bodies."),
        "429": { ...error("IP or tenant admission rate exceeded; preserve event identifiers on retry."), headers: { "Retry-After": { description: "Seconds until the next admission window.", schema: { type: "integer", minimum: 1, maximum: 60 } } } },
        "500": error("Unexpected request failure; preserve the event identifiers."),
        "503": error("Trusted identity or durable storage unavailable; nothing is silently accepted."),
      },
    },
    options: { summary: "First-party usage ingestion preflight", description: "Only https://xguardgate.com and https://api.xguardgate.com are allowed browser origins. Machine clients need no Origin header.", security: [], responses: { "204": { description: "Allowed POST preflight" }, "403": error("Origin, method or headers not allowed") } },
  };
}
