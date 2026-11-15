import { boundedJson, ceilRatio, fail, integer, parsed, record, usdMicros } from './common.js';

const definitions = {
  openrouter: { name: 'OpenRouter', kind: 'inference', base: 'https://openrouter.ai/api/v1', secret: 'OPENROUTER_API_KEY', terms: 'https://openrouter.ai/terms' },
  together: { name: 'Together AI', kind: 'inference', base: 'https://api.together.ai/v1', secret: 'TOGETHER_API_KEY', terms: 'https://www.together.ai/terms-of-service' },
  runpod: { name: 'RunPod Serverless', kind: 'gpu', base: 'https://api.runpod.ai/v2', secret: 'RUNPOD_API_KEY', terms: 'https://www.runpod.io/legal/terms-of-service' },
};
const healthCache = new Map();
const catalogCache = new Map();

// Credentials are never transferred to a buyer, accepted in request JSON, or
// forwarded to a caller-selected endpoint. All destinations are fixed here.
export class ComputeProviderAdapter {
  constructor(provider, env) { this.id = provider; this.env = env; this.definition = definitions[provider]; this.policy = parsed(env.XGUARD_COMPUTE_PROVIDERS)[provider] || {}; }
  blockers() {
    const p = this.policy, result = [];
    if (!this.env[this.definition.secret]) result.push(this.definition.secret + '_missing');
    if (p.enabled !== true) result.push('provider_not_enabled');
    if (p.resale_approved !== true || !/^https:\/\//.test(p.permission_reference || '')) result.push('resale_permission_not_verified');
    const age = Date.now() - Date.parse(p.reviewed_at);
    if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000) result.push('provider_policy_review_required');
    if (!Array.isArray(p.allowed_countries) || !p.allowed_countries.length || p.allowed_countries.some(c => !/^[A-Z]{2}$/.test(c))) result.push('customer_eligibility_configuration_required');
    if (!(p.daily_cap_atomic > 0) || !(p.request_cap_atomic > 0) || !(p.prepaid_available_atomic > 0)) result.push('spending_caps_or_prepaid_balance_missing');
    if (p.hard_cost_bound_verified !== true) result.push('upstream_hard_cost_bound_required');
    return result;
  }
  eligible(country) { return !this.blockers().length && this.policy.allowed_countries.includes(country); }
  async request(path, { method = 'GET', body, execution = false, maxBytes = 196608 } = {}) {
    let r;
    try { r = await fetch(this.definition.base + path, { method, headers: { authorization: 'Bearer ' + this.env[this.definition.secret], 'content-type': 'application/json', ...(this.id === 'openrouter' ? { 'HTTP-Referer': 'https://xguardgate.com', 'X-Title': 'XGuard Compute' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(execution ? 25000 : 5000) }); }
    catch { throw fail(execution ? 'upstream_execution_ambiguous' : 'provider_unavailable', 503, { ambiguous: execution }); }
    // Only an explicit rate-limit rejection is safe to fail over. In particular,
    // a timeout or 5xx can follow a billed execution. Access refusals never fail over.
    if (!r.ok) {
      await r.body?.cancel();
      throw fail(r.status === 403 || r.status === 451 ? 'provider_access_denied' : r.status === 429 ? 'provider_rate_limited' : 'provider_request_failed', 502,
        { rejected_before_execution: r.status === 429, ambiguous: execution && r.status >= 500, upstream_status: r.status });
    }
    try { return await boundedJson(r, maxBytes); } catch { throw fail(execution ? 'upstream_execution_ambiguous' : 'provider_response_invalid', 502, { ambiguous: execution }); }
  }
  async health({ fresh = false } = {}) {
    const blockers = this.blockers();
    if (blockers.length) return { provider: this.id, healthy: false, blockers };
    const slot = healthCache.get(this.id);
    if (!fresh && slot?.env === this.env && slot.until > Date.now()) return slot.value;
    const start = Date.now();
    try {
      if (!(await this.models()).length) throw fail('no_configured_models', 503);
      if (this.id === 'openrouter') {
        const [key, credits] = await Promise.all([this.request('/key'), this.request('/credits')]);
        const balance = Number(credits.data?.total_credits) - Number(credits.data?.total_usage);
        const remaining = key.data?.limit_remaining;
        if (!record(key.data) || !Number.isFinite(balance) || balance * 1000000 < this.policy.request_cap_atomic || remaining !== null && remaining !== undefined && Number(remaining) * 1000000 < this.policy.request_cap_atomic) throw fail('provider_low_balance', 503);
      }
      const value = { provider: this.id, healthy: true, latency_ms: Date.now() - start, checked_at: new Date().toISOString() };
      healthCache.set(this.id, { env: this.env, until: Date.now() + 30000, value }); return value;
    } catch { return { provider: this.id, healthy: false, blockers: ['provider_health_unavailable'], latency_ms: Date.now() - start }; }
  }
  async availability(input) { const health = await this.health(); return { ...health, compatible: health.healthy && Boolean((await this.models()).find(m => m.id === input.model)) }; }
  async models() { throw fail('adapter_not_implemented', 503); }
  async quote() { throw fail('adapter_not_implemented', 503); }
  async execute() { throw fail('adapter_not_implemented', 503); }
  async cancel() { throw fail('provider_cancellation_not_supported', 409); }
  async usage(result) { return result.usage || null; }
  async cost(result) { return result.cost_atomic ?? null; }
}

export class InferenceAdapter extends ComputeProviderAdapter {
  async models() {
    if (!Array.isArray(this.policy.models)) throw fail('model_allowlist_missing', 503);
    const configured = this.policy.models.filter(m => m.license_reviewed === true && /^https:\/\//.test(m.terms_reference || ''));
    let slot = catalogCache.get(this.id);
    if (!slot || slot.env !== this.env || slot.until < Date.now()) {
      slot = { env: this.env, data: await this.request('/models', { maxBytes: 4194304 }), observed_at: new Date().toISOString(), until: Date.now() + 15000 };
      catalogCache.set(this.id, slot);
    }
    const response = slot.data;
    if (this.id !== 'openrouter') {
      const listed = Array.isArray(response) ? response : response.data;
      if (!Array.isArray(listed)) throw fail('provider_model_catalog_invalid', 503);
      return configured.filter(m => listed.some(x => x.id === m.id));
    }
    if (!Array.isArray(response.data)) throw fail('provider_model_catalog_invalid', 503);
    return configured.flatMap(m => {
      const live = response.data.find(x => x.id === m.id);
      if (!live?.pricing || live.architecture?.input_modalities?.some(x => x !== 'text')) return [];
      // OpenRouter prices are USD/token; configuration uses microUSD/1M tokens.
      const prompt = usdMicros(String(Number(live.pricing.prompt) * 1000000));
      const completion = usdMicros(String(Number(live.pricing.completion) * 1000000));
      const request = usdMicros(live.pricing.request || '0');
      if (prompt > m.input_micros_per_million || completion > m.output_micros_per_million || request > (m.request_fee_atomic || 0)) return [];
      return [{ ...m, context_length: Math.min(m.context_length || live.context_length, live.context_length), price_checked_at: slot.observed_at }];
    });
  }
  async quote(input) {
    const m = (await this.models()).find(x => x.id === input.model);
    if (!m) throw fail('model_not_available', 422);
    // Byte upper bound plus a reviewed template allowance. Restricting input to
    // text roles avoids invisible image, audio, tool, web-search and sampling costs.
    const promptTokens = new TextEncoder().encode(input.messages.map(x => x.content).join('')).length + input.messages.length * 128 + 256;
    if (promptTokens + input.max_tokens > integer(m.context_length, 0, 1)) throw fail('context_limit_exceeded', 422);
    const cost = ceilRatio(promptTokens, integer(m.input_micros_per_million, undefined), 1000000)
      + ceilRatio(input.max_tokens, integer(m.output_micros_per_million, undefined), 1000000) + integer(m.request_fee_atomic, 0);
    return { provider: this.id, kind: 'inference', model: m.id, upstream_max_atomic: Math.max(1, cost), pricing: m, prompt_tokens_bound: promptTokens, observed_at: new Date().toISOString() };
  }
  async execute(input, quote, requestId) {
    const body = { model: input.model, messages: input.messages, max_tokens: input.max_tokens, temperature: input.temperature, stream: false, n: 1 };
    if (this.id === 'openrouter') body.provider = { allow_fallbacks: false, require_parameters: true, max_price: { prompt: quote.pricing.input_micros_per_million / 1000000, completion: quote.pricing.output_micros_per_million / 1000000 } };
    const result = await this.request('/chat/completions', { method: 'POST', body, execution: true });
    if (!Array.isArray(result.choices) || !result.choices.length || result.error) throw fail('upstream_execution_ambiguous', 502, { ambiguous: true });
    let cost = null, basis = 'unavailable';
    if (this.id === 'openrouter' && result.usage?.cost != null) { cost = usdMicros(result.usage.cost); basis = 'provider_reported_usage_cost'; }
    // A usage-derived estimate is never represented as an invoiced actual cost.
    return { completed: true, result: { id: result.id || requestId, model: result.model, choices: result.choices, usage: result.usage }, usage: result.usage || null, cost_atomic: cost, cost_basis: basis, upstream_id: result.id || null };
  }
}

export class RunPodAdapter extends ComputeProviderAdapter {
  async models() { return (this.policy.jobs || []).filter(x => /^[a-zA-Z0-9_-]{1,100}$/.test(x.endpoint_id) && x.image_digest?.includes('@sha256:')); }
  async health() {
    if (this.blockers().length) return { provider: this.id, healthy: false, blockers: this.blockers() };
    const jobs = await this.models();
    if (!jobs.length) return { provider: this.id, healthy: false, blockers: ['gpu_templates_missing'] };
    try { const value = await this.request('/' + jobs[0].endpoint_id + '/health'); return { provider: this.id, healthy: Boolean(value.workers), checked_at: new Date().toISOString() }; }
    catch { return { provider: this.id, healthy: false, blockers: ['provider_health_unavailable'] }; }
  }
  async quote(input) {
    const template = (await this.models()).find(x => x.id === input.template && x.gpu_type === input.gpu_type && x.region === input.region && (!input.image || input.image === x.image_digest) && (!input.command || JSON.stringify(input.command) === JSON.stringify(x.command)));
    if (!template || input.duration_seconds > integer(template.max_duration_seconds, 0, 1, 3600)) throw fail('gpu_template_not_available', 422);
    // Billing bound includes cold starts, initialization, cleanup and minimum
    // billing increments verified by the operator against this endpoint contract.
    const billedSeconds = input.duration_seconds + integer(template.overhead_seconds, undefined, 1, 3600);
    const cost = billedSeconds * integer(template.max_micros_per_second, undefined, 1) + integer(template.fixed_cost_atomic, 0);
    if (!Number.isSafeInteger(cost)) throw fail('price_overflow', 422);
    return { provider: this.id, kind: 'gpu', model: template.id, upstream_max_atomic: cost, pricing: template, observed_at: new Date().toISOString() };
  }
  async execute(input, quote) {
    const job = await this.request('/' + quote.pricing.endpoint_id + '/run', { method: 'POST', execution: true, body: { input: input.input, policy: { executionTimeout: input.duration_seconds * 1000, ttl: (input.duration_seconds + quote.pricing.overhead_seconds + 60) * 1000 } } });
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(job.id || '')) throw fail('upstream_execution_ambiguous', 502, { ambiguous: true });
    return { completed: false, upstream_id: job.id, status: job.status, cost_atomic: null, cost_basis: 'pending_provider_usage' };
  }
  async usage(job, quote) {
    const result = await this.request('/' + quote.pricing.endpoint_id + '/status/' + job.upstream_id);
    if (result.status === 'COMPLETED') return { completed: true, upstream_id: job.upstream_id, result: result.output, usage: { execution_ms: result.executionTime, delay_ms: result.delayTime }, cost_atomic: null, cost_basis: 'invoice_required' };
    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) throw fail('gpu_job_failed', 502, { ambiguous: false });
    return { completed: false, upstream_id: job.upstream_id, status: result.status, cost_atomic: null };
  }
  async cancel(job, quote) { return this.request('/' + quote.pricing.endpoint_id + '/cancel/' + job.upstream_id, { method: 'POST' }); }
}

export function adapters(env) { return Object.keys(definitions).map(p => p === 'runpod' ? new RunPodAdapter(p, env) : new InferenceAdapter(p, env)); }
export function providerCatalog(env) {
  return { providers: adapters(env).map(a => ({ id: a.id, name: a.definition.name, kind: a.definition.kind, connected: a.blockers().length === 0, blockers: a.blockers(), terms: a.definition.terms })), unavailable: [{ id: 'akash', connected: false, blockers: ['lease_signer_escrow_and_bounded_lifecycle_not_connected'], terms: 'https://console.akash.network/terms-of-service' }] };
}
export async function candidates(env, input, country, metrics = {}) {
  const list = [];
  for (const adapter of adapters(env)) {
    if (adapter.definition.kind !== input.kind || !adapter.eligible(country)) continue;
    try {
      const health = await adapter.health({ fresh: true });
      if (!health.healthy) continue;
      const quote = await adapter.quote(input);
      if (quote.upstream_max_atomic > adapter.policy.request_cap_atomic) continue;
      const failures = metrics[adapter.id]?.failures || 0;
      list.push({ ...quote, health, score: quote.upstream_max_atomic + Math.min(1000, health.latency_ms || 0) + Math.min(5000, failures * 100) - (input.preferred_provider === adapter.id ? 10000000 : 0) });
    } catch { /* Only configured compatible providers are candidates. No paid job is started here. */ }
  }
  return list.sort((a, b) => a.score - b.score).slice(0, 3);
}
