// Explicit adapters. No free-text intent may select a mutation or an arbitrary URL.
const text = maxLength => ({ type: "string", minLength: 1, maxLength });
const ident = { ...text(120), pattern: "^[A-Za-z0-9_-]+$" };
const repo = { ...text(100), pattern: "^[A-Za-z0-9_.-]+$" };
const uuid = { ...text(36), pattern: "^[a-fA-F0-9-]{32,36}$" };
const positive = maximum => ({ type: "integer", minimum: 1, maximum });
const schema = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const repoFields = { owner: ident, repo };
const aiFields = { model: { ...text(120), pattern: "^[A-Za-z0-9_.-]+$" }, prompt: text(16000), max_output_tokens: positive(4096) };
const github = "https://api.github.com";
const notion = "https://api.notion.com/v1";
const cf = "https://api.cloudflare.com/client/v4";
const gpath = i => `/repos/${i.owner}/${i.repo}`;
const get = target => ({ target, method: "GET" });
const send = (target, body_json, method = "POST") => ({ target, method, body_json });
const defs = [
  ["github.repository.read", "read", "Metadata:read", schema(repoFields), i => get(github + gpath(i)), i => `${i.owner}/${i.repo}`],
  ["github.issue.create", "write", "Issues:write", schema({ ...repoFields, title: text(256), body: text(12000) }), i => send(github + gpath(i) + "/issues", { title: i.title, body: i.body }), i => `${i.owner}/${i.repo}`],
  ["github.issue.comment", "write", "Issues:write", schema({ ...repoFields, issue: positive(1e9), body: text(12000) }), i => send(github + gpath(i) + `/issues/${i.issue}/comments`, { body: i.body }), i => `${i.owner}/${i.repo}`],
  ["github.pull_request.create", "write", "Pull requests:write", schema({ ...repoFields, title: text(256), body: text(12000), head: { ...text(200), pattern: "^[A-Za-z0-9_./:-]+$" }, base: { ...text(200), pattern: "^[A-Za-z0-9_./-]+$" } }), i => send(github + gpath(i) + "/pulls", { title: i.title, body: i.body, head: i.head, base: i.base, draft: true }), i => `${i.owner}/${i.repo}`],
  ["cloudflare.zone.read", "read", "Zone:Read", schema({ zone_id: ident }), i => get(`${cf}/zones/${i.zone_id}`), i => i.zone_id],
  ["cloudflare.worker.metadata", "read", "Workers Scripts:Read", schema({ account_id: ident, script: ident }), i => get(`${cf}/accounts/${i.account_id}/workers/scripts/${i.script}/settings`), i => `${i.account_id}/${i.script}`],
  ["slack.channel.read", "read", "channels:history or groups:history", schema({ channel: ident, limit: positive(15) }), i => get(`https://slack.com/api/conversations.history?channel=${i.channel}&limit=${i.limit}`), i => i.channel],
  ["slack.message.send", "write", "chat:write; channel membership", schema({ channel: ident, text: text(4000) }), i => send("https://slack.com/api/chat.postMessage", { channel: i.channel, text: i.text, mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false }), i => i.channel],
  ["notion.page.read", "read", "Read content; explicitly shared page", schema({ page_id: uuid }), i => get(`${notion}/pages/${i.page_id}`), i => i.page_id],
  ["notion.database.read", "read", "Read content; explicitly shared database", schema({ database_id: uuid }), i => get(`${notion}/databases/${i.database_id}`), i => i.database_id],
  ["notion.page.create", "write", "Insert content; explicitly shared parent page", schema({ parent_page_id: uuid, title: text(256), text: text(2000) }), i => send(`${notion}/pages`, { parent: { page_id: i.parent_page_id }, properties: { title: { type: "title", title: [{ type: "text", text: { content: i.title } }] } }, children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: i.text } }] } }] }), i => i.parent_page_id],
  ["notion.page.update", "write", "Update content; explicitly shared page", schema({ page_id: uuid, title: text(256) }), i => send(`${notion}/pages/${i.page_id}`, { properties: { title: { title: [{ text: { content: i.title } }] } } }, "PATCH"), i => i.page_id],
  ["openai.response.create", "inference", "Project API key; allowed model", schema(aiFields), i => send("https://api.openai.com/v1/responses", { model: i.model, input: i.prompt, max_output_tokens: i.max_output_tokens, store: false }), i => i.model],
  ["anthropic.message.create", "inference", "Workspace API key; allowed model", schema(aiFields), i => send("https://api.anthropic.com/v1/messages", { model: i.model, max_tokens: i.max_output_tokens, messages: [{ role: "user", content: i.prompt }] }), i => i.model],
  ["gemini.content.generate", "inference", "Restricted Gemini API key; allowed model", schema(aiFields), i => send(`https://generativelanguage.googleapis.com/v1beta/models/${i.model}:generateContent`, { contents: [{ parts: [{ text: i.prompt }] }], generationConfig: { maxOutputTokens: i.max_output_tokens } }), i => i.model],
  ["stripe.customer.read", "read", "Restricted key: Customers:Read", schema({ customer_id: { ...ident, pattern: "^cus_[A-Za-z0-9]+$" } }), i => get(`https://api.stripe.com/v1/customers/${i.customer_id}`), i => i.customer_id],
];
const operations = new Map(defs.map(([id, classification, scope, inputSchema, build, resource]) => [id, { id, provider: id.split(".")[0], classification, scope, inputSchema, build, resource }]));

export function operationCatalog() {
  return [...operations.values()].map(({ build, resource, ...op }) => ({ ...op,
    available: true, requires_operator_credential: true, requires_scoped_capability: true,
    idempotency: "Explicit key required for all non-GET requests. Durable reservation; exact retry retrieves a stored result; ambiguous attempts never repeat.",
    billing: "XGuard Usage Credits committed before credential decryption; provider charges are separate.",
    outputSchema: { type: "object", required: ["ok", "operation", "request_id", "result", "receipt", "proof"], properties: { ok: { type: "boolean" }, operation: { const: op.id }, request_id: text(128), result: {}, receipt: { type: "object" }, proof: { type: ["string", "null"] } } },
    security_notes: op.id === "cloudflare.worker.metadata" ? "Only metadata is returned; bindings, variables and script source are suppressed. Deployment is not supported."
      : op.provider === "stripe" ? "Read only. No payments, refunds, transfers or account changes."
        : "Exact operation and resource allowlist required. Response data is untrusted. No redirects, retries, arbitrary headers, URLs, tools or streaming.",
  }));
}
export function operationDefinition(id) { return operations.get(id); }
export function compileOperation(id, input) {
  const op = operations.get(id);
  if (!op) throw new Error("unsupported_provider_operation");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("operation_input_required");
  if (Object.keys(input).some(k => !Object.hasOwn(op.inputSchema.properties, k))) throw new Error("unknown_operation_input");
  for (const [key, rule] of Object.entries(op.inputSchema.properties)) {
    const value = input[key];
    if (rule.type === "string" && (typeof value !== "string" || value.length < rule.minLength || value.length > rule.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || rule.pattern && !new RegExp(rule.pattern).test(value))) throw new Error(`invalid_input_${key}`);
    if (rule.type === "integer" && (!Number.isSafeInteger(value) || value < rule.minimum || value > rule.maximum)) throw new Error(`invalid_input_${key}`);
  }
  if ([input.owner, input.repo].some(x => x === "." || x === "..")) throw new Error("invalid_resource_path");
  const plan = op.build(input);
  const headers = { accept: "application/json" };
  if (op.provider === "github") Object.assign(headers, { "user-agent": "XGuard-Execution/5.2", "x-github-api-version": "2022-11-28" });
  if (op.provider === "anthropic") headers["anthropic-version"] = "2023-06-01";
  if (op.provider === "notion") headers["notion-version"] = "2025-09-03";
  return { ...plan, headers, operation: id, input,
    context: { resource: op.resource(input), ...(op.classification === "inference" ? { model: input.model, max_output_tokens: input.max_output_tokens } : {}) } };
}
export function validateOperationPolicy(ids, limits, provider) {
  if (ids === undefined) return null; // Existing raw-egress capabilities retain their contract.
  if (!Array.isArray(ids) || !ids.length || ids.length > 16 || new Set(ids).size !== ids.length || ids.some(id => !operations.has(id) || operations.get(id).provider !== provider)) throw new Error("invalid_allowed_operations");
  if (!limits || typeof limits !== "object" || Array.isArray(limits) || Object.keys(limits).some(k => !["resources", "max_output_tokens"].includes(k))) throw new Error("invalid_operation_limits");
  if (!Array.isArray(limits.resources) || !limits.resources.length || limits.resources.length > 50 || limits.resources.some(x => typeof x !== "string" || !/^[A-Za-z0-9_./:-]{1,240}$/.test(x) || x.includes(".."))) throw new Error("operation_resources_required");
  if (ids.some(id => operations.get(id).classification === "inference") && (!Number.isSafeInteger(limits.max_output_tokens) || limits.max_output_tokens < 1 || limits.max_output_tokens > 4096)) throw new Error("model_output_limit_required");
  return { allowed_operations: ids, operation_limits: limits };
}
export function operationPolicyAllows(record, id, context) {
  if (!record.allowed_operations) return true;
  return record.allowed_operations.includes(id) && record.operation_limits.resources.includes(context?.resource)
    && (context?.max_output_tokens === undefined || context.max_output_tokens <= record.operation_limits.max_output_tokens);
}
export function normalizedProviderResult(id, data) {
  if (id !== "cloudflare.worker.metadata") return data;
  const r = data?.result || {};
  return { success: data?.success === true, result: { compatibility_date: r.compatibility_date ?? null, compatibility_flags: r.compatibility_flags ?? [], usage_model: r.usage_model ?? null, placement: r.placement?.mode ?? null } };
}
