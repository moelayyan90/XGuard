import { sha256 } from 'viem';
import { need, bytes, canonical, digest, keyId, publicKey, verify, unsigned, checkEnvelope, exact, amount } from './crypto.js';

export const PRICE = '50000'; // Experimental USD/USDC service fee, never merchant principal.
export const LIMITS = Object.freeze({ chain: 8, body: 32768, daily_operations: 500, daily_mutations: 5000, outstanding: 32, lifetime_operations: 100000, receipt_bytes: 8192 });
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const ZERO = () => ({ spent: '0', held: '0' });
const terminal = state => ['CONFIRMED', 'CANCELLED', 'FAILED'].includes(state);
const slot = (policy, now) => Math.floor(now / (policy.period_seconds * 1000));
const policyId = policy => [policy.network, policy.asset, policy.currency].join('|');

class Store {
  constructor(state) { this.state = state; this.reads = 0; this.writes = 0; }
  query(query, ...args) {
    const cursor = this.state.storage.sql.exec(query, ...args);
    const rows = [...cursor];
    this.reads += cursor.rowsRead; this.writes += cursor.rowsWritten;
    return rows;
  }
  get(key) { const row = this.query('SELECT value FROM afa_records WHERE key = ?', key)[0]; return row ? JSON.parse(row.value) : null; }
  put(key, value) { this.query('INSERT INTO afa_records(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  transaction(fn) { return this.state.storage.transactionSync(fn); }
  metrics() { return { sql_rows_read: this.reads, sql_rows_written: this.writes, scope: 'Actual SQLite cursor counters for this command; excludes ProofRail, Worker, network, schema creation and provider billing.' }; }
}
function validatePolicy(p) {
  exact(p, ['currency', 'asset', 'network', 'per_operation', 'per_period', 'lifetime', 'period_seconds', 'payees']);
  need(/^[A-Z][A-Z0-9]{1,11}$/.test(p.currency) && /^[A-Za-z0-9:._-]{1,160}$/.test(p.asset) && /^[A-Za-z0-9:._-]{1,80}$/.test(p.network), 'invalid_currency_profile');
  need([3600, 86400].includes(p.period_seconds), 'invalid_budget_period');
  need(amount(p.per_operation) <= amount(p.per_period) && amount(p.per_period) <= amount(p.lifetime), 'invalid_budget_limits');
  need(Array.isArray(p.payees) && p.payees.length > 0 && p.payees.length <= 20 && new Set(p.payees).size === p.payees.length && p.payees.every(x => typeof x === 'string' && /^[A-Za-z0-9:._-]{1,160}$/.test(x)), 'exact_payees_required');
}
function attenuates(child, parent) {
  return policyId(child) === policyId(parent) && child.period_seconds === parent.period_seconds &&
    ['per_operation', 'per_period', 'lifetime'].every(k => BigInt(child[k]) <= BigInt(parent[k])) && child.payees.every(x => parent.payees.includes(x));
}
function usage(store, name, policy, now) {
  const periodKey = `period:${name}:${slot(policy, now)}`, lifeKey = `life:${name}`;
  return { name, policy, periodKey, lifeKey, period: store.get(periodKey) || ZERO(), life: store.get(lifeKey) || ZERO() };
}
function reserveUsage(store, list, value) {
  for (const u of list) {
    need(value <= BigInt(u.policy.per_operation), 'per_operation_limit', 403);
    need(BigInt(u.period.spent) + BigInt(u.period.held) + value <= BigInt(u.policy.per_period), 'period_budget_exceeded', 403);
    need(BigInt(u.life.spent) + BigInt(u.life.held) + value <= BigInt(u.policy.lifetime), 'lifetime_budget_exceeded', 403);
  }
  for (const u of list) for (const [key, counter] of [[u.periodKey, u.period], [u.lifeKey, u.life]]) store.put(key, { ...counter, held: (BigInt(counter.held) + value).toString() });
}
function releaseUsage(store, op, spend) {
  for (const keys of op.usage_keys) for (const key of keys) {
    const counter = store.get(key);
    need(counter && BigInt(counter.held) >= BigInt(op.reserved_atomic), 'ledger_invariant_failed', 503);
    store.put(key, { held: (BigInt(counter.held) - BigInt(op.reserved_atomic)).toString(), spent: (BigInt(counter.spent) + (spend ? BigInt(spend) : 0n)).toString() });
  }
}
function audit(store, org, action, op, now) {
  const seq = (org.audit_sequence || 0) + 1;
  const event = { sequence: seq, previous_hash: org.audit_head || null, action, operation_id: op || null, at: now };
  event.hash = sha256(bytes(event));
  store.put(`audit:${seq}`, event); org.audit_sequence = seq; org.audit_head = event.hash;
  return event;
}
function admission(org, now, operation = false) {
  const day = Math.floor(now / 86400000);
  if (org.day !== day) { org.day = day; org.day_operations = 0; org.day_mutations = 0; }
  need((org.day_mutations || 0) < LIMITS.daily_mutations, 'tenant_mutation_capacity', 429);
  if (operation) {
    need((org.day_operations || 0) < LIMITS.daily_operations && (org.total_operations || 0) < LIMITS.lifetime_operations, 'tenant_operation_capacity', 429);
    need((org.outstanding || 0) < LIMITS.outstanding, 'tenant_outstanding_capacity', 429);
    org.day_operations = (org.day_operations || 0) + 1; org.total_operations = (org.total_operations || 0) + 1;
    org.outstanding = (org.outstanding || 0) + 1;
  }
  org.day_mutations = (org.day_mutations || 0) + 1;
}
function chainFor(store, grantId, org, now, active = true) {
  const chain = []; let next = grantId;
  while (next) {
    need(chain.length < LIMITS.chain && !chain.some(g => g.id === next), 'delegation_depth_or_cycle', 403);
    const grant = store.get(`grant:${next}`);
    need(grant, 'unknown_delegation', 403);
    if (active) need(!store.get(`revoked:${next}`) && grant.expires_at > now && grant.not_before <= now, 'delegation_inactive', 403);
    chain.unshift(grant); next = grant.parent;
  }
  need(chain.length > 0 && chain[0].issuer === org.owner_id, 'untrusted_delegation_root', 403);
  for (let i = 1; i < chain.length; i++) need(chain[i].issuer === chain[i - 1].agent_id && attenuates(chain[i].policy, chain[i - 1].policy) && chain[i].expires_at <= chain[i - 1].expires_at && chain[i].not_before >= chain[i - 1].not_before && chain[i].depth_remaining < chain[i - 1].depth_remaining, 'delegation_escalation', 403);
  if (active) need(!org.revoked, 'organization_revoked', 403);
  return chain;
}
function authorizedForOperation(e, op, org) { need(e.signer === org.owner_id || e.signer === op.agent_id, 'operation_access_denied', 403); }
function view(op) {
  return { ...op, retry_execution: false, new_payment_required: false,
    guarantees: { budget: 'Reserved across every ancestor and the organization in one SQLite transaction.', revocation: 'Checked atomically before dispatch; an already dispatched external side effect cannot be recalled.', settlement: 'Only a pinned executor attestation may confirm; no independent blockchain finality is asserted.' } };
}

export async function authorityCommand(state, env, envelope) {
  state.storage.sql.exec('CREATE TABLE IF NOT EXISTS afa_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const store = new Store(state), now = Date.now(), mode = env.AFA_MODE === 'live' ? 'live' : 'sandbox';
  const e = envelope, action = e?.action;
  need(['enroll', 'grant', 'authorize', 'status', 'execute', 'reconcile', 'cancel', 'revoke', 'audit', 'metrics'].includes(action), 'unknown_authority_action', 404);
  checkEnvelope(e, action, mode, now);
  // This release is intentionally limited to sandbox. Live activation needs a
  // reviewed executor, service-fee budget/collection, a state-version guard and
  // separate owner approval. An environment toggle cannot activate real spend.
  need(mode === 'sandbox', 'live_authority_not_approved', 503);
  if (action === 'enroll') need(env.AFA_ENROLLMENT_AUTHORIZED === true, 'operator_enrollment_required', 403);
  let org = store.get('organization');
  let jwk;
  if (action === 'enroll') jwk = publicKey(e.payload.owner_key);
  else {
    need(org && org.id === e.org_id && org.mode === mode, 'organization_not_found', 404);
    jwk = e.signer === org.owner_id ? org.owner_key : store.get(`agent:${e.signer}`)?.key;
    need(jwk, 'agent_not_registered', 401);
  }
  need(e.signer === await keyId(jwk) && await verify(unsigned(e), e.signature, jwk), 'invalid_agent_signature', 401);
  const requestDigest = await digest(unsigned(e));
  const chainId = action === 'grant' ? e.payload.parent : action === 'authorize' ? e.payload.grant_id : ['execute', 'reconcile'].includes(action) ? store.get(`op:${e.payload.operation_id}`)?.grant_id : null;
  const chain = chainId ? chainFor(store, chainId, org, now, ['authorize', 'grant'].includes(action)) : [];
  // Reverify all original grant signatures, rather than trusting a caller's list.
  for (const grant of chain) {
    const issuerKey = grant.issuer === org.owner_id ? org.owner_key : store.get(`agent:${grant.issuer}`)?.key;
    need(issuerKey && await verify(unsigned(grant.envelope), grant.envelope.signature, issuerKey), 'invalid_delegation_signature', 403);
    const signed = grant.envelope.payload;
    need(grant.envelope.org_id === org.id && grant.envelope.mode === mode && grant.envelope.signer === grant.issuer && grant.envelope.action === 'grant' && signed.grant_id === grant.id && signed.parent === grant.parent && canonical(signed.policy) === canonical(grant.policy) && signed.expires_at === grant.expires_at && signed.not_before === grant.not_before && signed.depth_remaining === grant.depth_remaining && await keyId(signed.agent_key) === grant.agent_id, 'delegation_record_mismatch', 403);
  }
  const agentId = action === 'grant' ? await keyId(e.payload.agent_key) : null;
  const intentDigest = action === 'authorize' ? await digest(e.payload) : null;
  const chainDigest = await digest(chain.map(g => unsigned(g.envelope)));
  const result = store.transaction(() => {
    org = store.get('organization');
    if (action === 'enroll') {
      exact(e.payload, ['owner_key', 'policies', 'accept_price_atomic']);
      need(!org, 'organization_exists', 409);
      need(e.payload.accept_price_atomic === PRICE && Array.isArray(e.payload.policies) && e.payload.policies.length > 0 && e.payload.policies.length <= 8, 'explicit_price_and_budget_required');
      for (const p of e.payload.policies) validatePolicy(p);
      need(new Set(e.payload.policies.map(policyId)).size === e.payload.policies.length, 'duplicate_currency_profile');
      org = { id: e.org_id, mode, owner_key: jwk, owner_id: e.signer, policies: e.payload.policies, accepted_price_atomic: PRICE, audit_sequence: 0, outstanding: 0 };
      audit(store, org, 'enrolled', null, now); store.put('organization', org);
      return { organization_id: org.id, owner_id: org.owner_id, mode, legal_identity_verified: false };
    }
    need(org?.id === e.org_id && org.mode === mode, 'organization_not_found', 404);
    if (['status', 'audit', 'metrics'].includes(action)) {
      if (action === 'status') {
        exact(e.payload, ['operation_id']); const op = store.get(`op:${e.payload.operation_id}`);
        need(op, 'operation_not_found', 404); authorizedForOperation(e, op, org); return view(op);
      }
      need(e.signer === org.owner_id, 'owner_required', 403);
      if (action === 'metrics') return { total_operations: org.total_operations || 0, outstanding: org.outstanding || 0, completed: org.completed || 0, independent_paying_customers: null, commercial_revenue_proven: false,
        billing: { assessed_usdc_atomic: org.assessed || '0', collected_usdc_atomic: '0', pending_usdc_atomic: org.assessed || '0', actual_cost_usd: null, actual_profit_usd: null, reason: 'No service-fee collection adapter or invoice reconciliation has been activated.' } };
      exact(e.payload, ['from', 'limit']);
      need(Number.isSafeInteger(e.payload.from) && e.payload.from >= 1 && Number.isSafeInteger(e.payload.limit) && e.payload.limit >= 1 && e.payload.limit <= 100, 'invalid_audit_page');
      return { events: Array.from({ length: Math.min(e.payload.limit, Math.max(0, org.audit_sequence - e.payload.from + 1)) }, (_, i) => store.get(`audit:${e.payload.from + i}`)), last_sequence: org.audit_sequence };
    }
    const replay = store.get(`nonce:${e.nonce}`);
    if (replay) {
      need(replay.digest === requestDigest, 'nonce_replay_conflict', 409);
      if (replay.operation_id) return { ...view(store.get(`op:${replay.operation_id}`)), replay: true };
      return { ...replay.result, replay: true };
    }
    let value;
    if (action === 'grant') {
      const p = e.payload;
      exact(p, ['grant_id', 'parent', 'agent_key', 'policy', 'not_before', 'expires_at', 'depth_remaining']);
      need(id(p.grant_id) && (p.parent === null || id(p.parent)) && !store.get(`grant:${p.grant_id}`), 'grant_id_conflict', 409);
      validatePolicy(p.policy);
      need(Number.isSafeInteger(p.not_before) && Number.isSafeInteger(p.expires_at) && p.not_before <= now && p.expires_at > now && p.expires_at <= now + 30 * 86400000 && Number.isSafeInteger(p.depth_remaining) && p.depth_remaining >= 0 && p.depth_remaining < LIMITS.chain, 'invalid_delegation_window');
      const parentChain = p.parent ? chainFor(store, p.parent, org, now) : [];
      const parent = parentChain.at(-1), upper = parent?.policy || org.policies.find(x => policyId(x) === policyId(p.policy));
      need(!org.revoked && upper && attenuates(p.policy, upper), 'delegation_escalation', 403);
      need(parent ? e.signer === parent.agent_id && p.depth_remaining < parent.depth_remaining && p.expires_at <= parent.expires_at && p.not_before >= parent.not_before : e.signer === org.owner_id, 'delegation_issuer_denied', 403);
      need(parentChain.length < LIMITS.chain, 'delegation_depth_or_cycle', 403);
      // agent_id is computed before this synchronous transaction below.
      need(!store.get(`agent:${agentId}`) && agentId !== org.owner_id, 'agent_identity_already_delegated', 409);
      admission(org, now);
      const record = { id: p.grant_id, parent: p.parent, issuer: e.signer, agent_id: agentId, policy: p.policy, not_before: p.not_before, expires_at: p.expires_at, depth_remaining: p.depth_remaining, envelope: e };
      store.put(`agent:${agentId}`, { key: publicKey(p.agent_key), grant_id: p.grant_id }); store.put(`grant:${p.grant_id}`, record);
      value = { grant_id: p.grant_id, agent_id: agentId, parent: p.parent }; audit(store, org, 'grant_created', null, now);
    } else if (action === 'authorize') {
      const p = e.payload;
      exact(p, ['operation_id', 'grant_id', 'currency', 'asset', 'network', 'payee', 'principal_atomic', 'provider_fee_cap_atomic', 'max_service_fee_atomic', 'adapter', 'task_digest', 'expires_at']);
      need(id(p.operation_id) && /^[A-Za-z0-9_-]{1,40}$/.test(p.adapter) && /^[A-Za-z0-9_-]{43}$/.test(p.task_digest), 'invalid_operation');
      const existing = store.get(`op:${p.operation_id}`);
      if (existing) { need(existing.intent_digest === intentDigest && existing.agent_id === e.signer, 'idempotency_conflict', 409); return { ...view(existing), replay: true }; }
      const currentChain = chainFor(store, p.grant_id, org, now);
      need(currentChain.at(-1).agent_id === e.signer, 'leaf_agent_required', 403);
      const policy = currentChain.at(-1).policy;
      need(policyId(p) === policyId(policy) && policy.payees.includes(p.payee), 'payment_context_denied', 403);
      need(amount(p.max_service_fee_atomic, false) >= BigInt(PRICE), 'service_fee_budget_exceeded', 403);
      const principal = amount(p.principal_atomic), provider = amount(p.provider_fee_cap_atomic, false), total = principal + provider;
      need(Number.isSafeInteger(p.expires_at) && p.expires_at > now && p.expires_at <= now + 300000 && currentChain.every(g => p.expires_at <= g.expires_at), 'invalid_operation_expiry');
      const rootPolicy = org.policies.find(x => policyId(x) === policyId(policy));
      const list = [usage(store, `org:${policyId(policy)}`, rootPolicy, now), ...currentChain.map(g => usage(store, `grant:${g.id}`, g.policy, now))];
      admission(org, now, true); reserveUsage(store, list, total);
      value = { ...p, agent_id: e.signer, organization_id: org.id, intent_digest: intentDigest, mode, state: 'RESERVED', reserved_atomic: total.toString(), usage_keys: list.map(u => [u.periodKey, u.lifeKey]), chain_ids: currentChain.map(g => g.id), chain_digest: chainDigest, created_at: now, service_fee: { proposed_usdc_atomic: PRICE, assessed_usdc_atomic: '0', collected_usdc_atomic: '0', payee: env.XGUARD_TREASURY_USDC_ADDRESS || null }, settlement: null };
      const event = audit(store, org, 'reserved', p.operation_id, now); value.audit_sequence = event.sequence; value.audit_head = event.hash; store.put(`op:${p.operation_id}`, value);
    } else if (action === 'revoke') {
      exact(e.payload, ['grant_id']); need(e.signer === org.owner_id, 'owner_required', 403);
      need(e.payload.grant_id === null || store.get(`grant:${e.payload.grant_id}`), 'unknown_delegation', 404);
      admission(org, now);
      if (e.payload.grant_id === null) org.revoked = true; else store.put(`revoked:${e.payload.grant_id}`, { revoked_at: now });
      value = { revoked: true, grant_id: e.payload.grant_id, effective_at: now, scope: 'Stops new reservation and dispatch. Already dispatched work remains held until authenticated reconciliation.' };
      audit(store, org, 'revoked', null, now);
    } else {
      exact(e.payload, ['operation_id']); const op = store.get(`op:${e.payload.operation_id}`);
      need(op, 'operation_not_found', 404); authorizedForOperation(e, op, org);
      if (terminal(op.state)) return { ...view(op), replay: true };
      if (action === 'cancel') {
        need(op.state === 'RESERVED', 'execution_may_have_started', 409); admission(org, now);
        releaseUsage(store, op, false); op.state = 'CANCELLED'; org.outstanding--; audit(store, org, 'cancelled', op.operation_id, now);
      } else if (action === 'execute') {
        if (op.state !== 'RESERVED') return { ...view(op), replay: true };
        need(env.AFA_EXECUTOR && env.AFA_EXECUTOR_PUBLIC_JWK, 'execution_adapter_not_configured', 503);
        need(op.adapter === env.AFA_EXECUTOR_ADAPTER, 'execution_adapter_not_allowed', 503);
        need(op.expires_at > now, 'reservation_expired_cancel_required', 409);
        chainFor(store, op.grant_id, org, now); admission(org, now);
        op.state = 'DISPATCHING'; op.dispatched_at = now; audit(store, org, 'dispatch_committed', op.operation_id, now);
      } else {
        need(['DISPATCHING', 'UNKNOWN'].includes(op.state), 'operation_not_dispatched', 409);
        need(env.AFA_EXECUTOR && env.AFA_EXECUTOR_PUBLIC_JWK, 'execution_adapter_not_configured', 503); admission(org, now);
      }
      op.audit_head = org.audit_head; op.audit_sequence = org.audit_sequence;
      store.put(`op:${op.operation_id}`, op); value = view(op);
    }
    store.put('organization', org);
    store.put(`nonce:${e.nonce}`, { digest: requestDigest, ...(value.operation_id ? { operation_id: value.operation_id } : { result: value }) });
    return value;
  });
  if (result.state === 'DISPATCHING' && !result.replay && ['execute', 'reconcile'].includes(action) || result.state === 'UNKNOWN' && !result.replay && action === 'reconcile') {
    return settleAdapter(store, env, result, action, now);
  }
  return { ...result, measured_resources: store.metrics() };

}

async function settleAdapter(store, env, op, action, started) {
  let evidence = null;
  try {
    const response = await env.AFA_EXECUTOR.fetch(`https://afa-executor/${action === 'reconcile' ? 'status' : 'execute'}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${op.organization_id}:${op.operation_id}` },
      body: JSON.stringify({ protocol: 'xguard-afa-executor/1', operation: op }), signal: AbortSignal.timeout(8000),
    });
    need(response.ok && Number(response.headers.get('content-length') || 0) <= LIMITS.body, 'invalid_executor_response');
    const reader = response.body?.getReader(); need(reader, 'invalid_executor_response');
    let text = '', length = 0; const decoder = new TextDecoder();
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > LIMITS.body) { await reader.cancel(); throw new Error('executor_response_too_large'); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    const signed = JSON.parse(text), payload = signed.payload;
    const pin = typeof env.AFA_EXECUTOR_PUBLIC_JWK === 'string' ? JSON.parse(env.AFA_EXECUTOR_PUBLIC_JWK) : env.AFA_EXECUTOR_PUBLIC_JWK;
    need(await verify(payload, signed.signature, pin), 'invalid_executor_attestation');
    need(payload.protocol === 'xguard-afa-settlement/1' && payload.organization_id === op.organization_id && payload.mode === op.mode && payload.operation_id === op.operation_id && payload.intent_digest === op.intent_digest && payload.payee === op.payee && payload.currency === op.currency && payload.asset === op.asset && payload.network === op.network && payload.principal_atomic === op.principal_atomic, 'settlement_binding_mismatch');
    need(amount(payload.provider_fee_atomic, false) <= BigInt(op.provider_fee_cap_atomic), 'provider_fee_cap_exceeded');
    need(['confirmed', 'failed_no_effect', 'unknown'].includes(payload.status) && Number.isSafeInteger(payload.observed_at) && payload.observed_at >= op.dispatched_at && payload.observed_at <= Date.now() + 30000, 'invalid_settlement_state');
    if (payload.status === 'confirmed') need(typeof payload.transaction === 'string' && payload.transaction.length > 0 && payload.transaction.length <= 160, 'settlement_reference_required');
    if (payload.status === 'failed_no_effect') need(payload.provider_fee_atomic === '0', 'failed_no_effect_fee_conflict');
    evidence = { payload, signature: signed.signature, key_id: await keyId(pin), verification_scope: 'Pinned executor attestation, not independent chain finality.' };
  } catch { /* Uncertain effects retain the entire reservation. Never redispatch. */ }
  return store.transaction(() => {
    const current = store.get(`op:${op.operation_id}`), org = store.get('organization');
    if (terminal(current.state)) return { ...view(current), replay: true, measured_resources: store.metrics() };
    need(['DISPATCHING', 'UNKNOWN'].includes(current.state), 'invalid_transition', 409);
    if (evidence?.payload.status === 'confirmed' || evidence?.payload.status === 'failed_no_effect') {
      const confirmed = evidence.payload.status === 'confirmed';
      releaseUsage(store, current, confirmed ? (BigInt(current.principal_atomic) + BigInt(evidence.payload.provider_fee_atomic)).toString() : false);
      current.state = confirmed ? 'CONFIRMED' : 'FAILED'; org.outstanding--;
      if (confirmed) {
        org.completed = (org.completed || 0) + 1;
        const assessed = current.mode === 'live' ? PRICE : '0';
        current.service_fee.assessed_usdc_atomic = assessed; org.assessed = (BigInt(org.assessed || '0') + BigInt(assessed)).toString();
      }
    } else current.state = 'UNKNOWN';
    current.settlement = evidence; current.last_checked_at = Date.now();
    current.audit_sequence = audit(store, org, current.state.toLowerCase(), current.operation_id, current.last_checked_at).sequence;
    current.audit_head = org.audit_head;
    store.put(`op:${current.operation_id}`, current); store.put('organization', org);
    return { ...view(current), measured_resources: store.metrics(), adapter_latency_ms: Date.now() - started };
  });
}
