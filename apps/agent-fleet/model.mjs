const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class ModelError extends Error {
  constructor(code, message, { blocked = false, retryable = false } = {}) {
    super(message); this.name = 'ModelError'; this.code = code;
    this.blocked = blocked; this.retryable = retryable;
  }
}

export function localModelUrl(value = 'http://127.0.0.1:8080') {
  let url;
  try { url = new URL(value); } catch { throw new ModelError('invalid_model_url', 'A local model URL is required'); }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ModelError('invalid_model_url', 'Inference is restricted to a local llama.cpp server; paid remote endpoints are disabled');
  }
  return url.origin;
}

export function validateAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelError('invalid_model_action', 'Expected a structured action');
  const actionFields = {
    finish: ['text'], write_file: ['path', 'content'], read_file: ['path'], web_get: ['url'],
  };
  const fields = Object.hasOwn(actionFields, value.action) ? actionFields[value.action] : undefined;
  if (!fields || Object.keys(value).some(k => !['action', ...fields].includes(k))) throw new ModelError('invalid_model_action', 'Unknown action or unexpected fields');
  for (const key of fields) {
    if (typeof value[key] !== 'string' || (key !== 'content' && !value[key].trim()) || Buffer.byteLength(value[key]) > 65536) {
      throw new ModelError('invalid_model_action', `Invalid ${key}`);
    }
  }
  return value;
}

const ACTION_SCHEMA = {
  oneOf: [
    { type: 'object', properties: { action: { const: 'finish' }, text: { type: 'string', minLength: 1 } }, required: ['action', 'text'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'write_file' }, path: { type: 'string', minLength: 1 }, content: { type: 'string' } }, required: ['action', 'path', 'content'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'read_file' }, path: { type: 'string', minLength: 1 } }, required: ['action', 'path'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'web_get' }, url: { type: 'string', minLength: 1 } }, required: ['action', 'url'], additionalProperties: false },
  ],
};

async function boundedText(response, maxBytes = 262144) {
  const chunks = []; let size = 0;
  if (!response.body) return '';
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new ModelError('model_response_too_large', 'Model response exceeded the byte limit');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class LocalModel {
  constructor({ baseUrl = 'http://127.0.0.1:8080', fetchImpl = globalThis.fetch, timeoutMs = 90000, apiKey } = {}) {
    this.baseUrl = localModelUrl(baseUrl); this.fetchImpl = fetchImpl;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new ModelError('invalid_timeout', 'Model timeout must be 100–120000 ms');
    this.timeoutMs = timeoutMs;
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(apiKey))) throw new ModelError('invalid_local_key', 'Invalid local model credential');
    this.headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  }
  async health({ signal } = {}) {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: 'GET', headers: this.headers, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]),
      });
      await boundedText(response, 8192);
      return { reachable: response.ok, kind: 'local-llama-cpp', paidApiCalls: 0 };
    } catch { return { reachable: false, kind: 'local-llama-cpp', paidApiCalls: 0 }; }
  }
  async complete({ messages, maxTokens = 256, signal, allowedActions = ['finish', 'write_file', 'read_file', 'web_get'], maxTextChars = 16384 } = {}) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 32 ||
        Buffer.byteLength(JSON.stringify(messages)) > 49152 || !Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 1024) {
      throw new ModelError('invalid_model_request', 'Prompt or generation limit is invalid');
    }
    if (!Array.isArray(allowedActions) || !allowedActions.length || allowedActions.some(x => !['finish', 'write_file', 'read_file', 'web_get'].includes(x))) throw new ModelError('invalid_model_request', 'Invalid action schema');
    if (!Number.isInteger(maxTextChars) || maxTextChars < 32 || maxTextChars > 16384) throw new ModelError('invalid_model_request', 'Invalid final-text limit');
    const schema = { oneOf: ACTION_SCHEMA.oneOf.filter(x => allowedActions.includes(x.properties.action.const)).map(item => structuredClone(item)) };
    for (const item of schema.oneOf) if (item.properties.action.const === 'finish') item.properties.text.maxLength = maxTextChars;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...this.headers },
        signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]),
        body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.7, top_p: 0.8, top_k: 20,
          presence_penalty: 1.5, stream: false, chat_template_kwargs: { enable_thinking: false },
          response_format: { type: 'json_object', schema } }),
      });
    } catch {
      throw new ModelError(signal?.aborted ? 'cancelled' : 'model_unavailable',
        signal?.aborted ? 'The run was paused' : 'The local model server is unavailable or timed out', { blocked: true, retryable: true });
    }
    let raw;
    try { raw = await boundedText(response); }
    catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError(signal?.aborted ? 'cancelled' : 'model_response_interrupted', 'Local model response was interrupted', { blocked: true, retryable: true });
    }
    if (!response.ok) throw new ModelError([401, 403].includes(response.status) ? 'model_auth_required' : 'model_http_error', `Local inference returned HTTP ${response.status}`, { blocked: [401, 403, 429, 503].includes(response.status), retryable: response.status >= 500 });
    let result;
    try { result = JSON.parse(raw); } catch { throw new ModelError('invalid_model_response', 'Local model did not return JSON'); }
    const choice = result?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ModelError('model_output_truncated', 'Generation stopped at its token limit');
    let content = choice?.message?.content;
    if (typeof content !== 'string') throw new ModelError('invalid_model_response', 'Local model returned no content');
    // Qwen may emit empty reasoning tags even when thinking is disabled.
    content = content.replace(/^\s*<think>\s*<\/think>\s*/, '');
    let action;
    try { action = JSON.parse(content); } catch { throw new ModelError('invalid_model_action', 'Model content did not satisfy the action schema'); }
    validateAction(action);
    if (!allowedActions.includes(action.action)) throw new ModelError('invalid_model_action', 'Model action was outside this step’s allowed schema');
    if (action.action === 'finish' && [...action.text].length > maxTextChars) throw new ModelError('invalid_model_action', 'Model final text exceeded its schema limit');
    return action;
  }
}
