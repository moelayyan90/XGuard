import { fetchPublic, type FetchSource, type Row } from './engine.ts';
import { extractDocument } from '../outcome-engine.js';
import { hash } from '../live/util.ts';
import { SERVICES } from './catalog.ts';
const json = (body: Row, status = 200) => Response.json(body, { status });
const iso = () => new Date().toISOString();
const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
function view(task: Row) {
  const { task_token, payment_identifier, ...visible } = task;
  return { ...visible, payment_reference: payment_identifier, status_url: 'https://api.xguardgate.com/v1/tasks/' + task.task_id, authentication: 'Authorization: Bearer <task_token>' };
}
async function authenticate(task: Row | undefined, token: string) {
  if (!task || typeof token !== 'string' || token.length > 128 || await hash(token) !== await hash(task.task_token)) return false;
  return true;
}
export async function networkState(state: any, path: string, body: Row): Promise<Response> {
  return state.blockConcurrencyWhile(async () => {
    if (path.startsWith('/network/graph-')) {
      const graph = await state.storage.get('network:graph') || { records: {}, history: [], next_check: 0, cursor: 0 };
      if (path === '/network/graph-read') return json({ records: graph.records, history: graph.history, next_check: graph.next_check });
      if (path === '/network/graph-claim') {
        if (graph.next_check > Date.now()) return json({ services: [] });
        const services = SERVICES.slice(graph.cursor, graph.cursor + 3); graph.cursor += services.length;
        if (graph.cursor >= SERVICES.length) { graph.cursor = 0; graph.next_check = Date.now() + 86400000; }
        else graph.next_check = Date.now() + 600000;
        await state.storage.put('network:graph', graph); return json({ services });
      }
      if (path === '/network/graph-record') {
        if (!SERVICES.some(s => s.id === body.record?.id)) return json({ error: 'unknown_graph_service' }, 400);
        const prior = graph.records[body.record.id];
        if (prior && prior.source_hash !== body.record.source_hash) graph.history.push({ service_id: body.record.id, old_hash: prior.source_hash || null, new_hash: body.record.source_hash || null, observed_at: iso(), event: 'documentation_evidence_changed' });
        graph.history = graph.history.slice(-100); graph.records[body.record.id] = body.record;
        await state.storage.put('network:graph', graph); return json({ recorded: true });
      }
      return json({ error: 'graph_action_not_found' }, 404);
    }
    let task = await state.storage.get('network:task');
    if (path === '/network/create') {
      if (task) {
        if (task.payment_identifier !== body.payment_identifier) return json({ error: 'task_payment_conflict' }, 409);
        return json({ ...view(task), task_token: task.task_token });
      }
      if (!/^xgtask_[a-f0-9]{32}$/.test(body.task_id || '') || !body.input?.steps?.length || !body.payment_identifier) return json({ error: 'invalid_task_creation' }, 400);
      task = { task_id: body.task_id, task_token: crypto.randomUUID() + crypto.randomUUID(), payment_identifier: body.payment_identifier,
        status: 'PENDING', created_at: iso(), updated_at: iso(), input: body.input, current_step: 0, current_run: 1,
        checkpoints: [], outputs: [], failures: [], events: [{ at: iso(), type: 'task.created' }], attempts: 0, provider_switches: 0,
        fee_atomic: '30000', budget_atomic: body.input.budget_atomic, external_spend_atomic: '0', maximum_attempts_per_step: 3,
        verification_state: 'PENDING', protected: false, credit_used_atomic: '0', expires_at: Date.now() + 31 * 86400000 };
      // The task and its wakeup must commit together. No existing financial keys change.
      await state.storage.transaction(async (tx: any) => { await tx.put('network:task', task); await tx.setAlarm(body.input.run_at ? Math.max(Date.now() + 1000, Date.parse(body.input.run_at)) : Date.now() + 1000); });
      return json({ ...view(task), task_token: task.task_token, fee_breakdown: { durable_task: '10000', bounded_execution: '10000', checkpoints_retry_and_verification: '10000', total: '30000', currency: 'USDC' } });
    }
    if (!await authenticate(task, body.token)) return json({ error: 'task_not_found_or_unauthorized' }, 404);
    if (path === '/network/status') return json(view(task));
    if (path === '/network/cancel') {
      if (terminal.has(task.status)) return json(view(task));
      task.status = 'CANCELLED'; task.updated_at = iso(); task.events.push({ at: iso(), type: 'task.cancelled' });
      await state.storage.put('network:task', task); await state.storage.deleteAlarm(); return json(view(task));
    }
    if (path === '/network/resume') {
      // Recovery is included in the original bounded contract, not a new purchase.
      if (['COMPLETED', 'CANCELLED'].includes(task.status)) return json({ error: 'terminal_task' }, 409);
      if (task.attempts >= 3 || task.expires_at < Date.now()) return json({ error: 'retry_budget_exhausted' }, 409);
      task.status = 'PENDING'; task.updated_at = iso();
      await state.storage.transaction(async (tx: any) => { await tx.put('network:task', task); await tx.setAlarm(Date.now() + 1000); });
      return json(view(task));
    }
    if (path === '/network/verify') return json({ task_id: task.task_id, verification_state: task.verification_state, acceptance: task.input.steps.map((s: Row) => ({ kind: s.kind, expected_status: s.expected_status })), checkpoints: task.checkpoints, status: task.status });
    return json({ error: 'network_state_route_not_found' }, 404);
  });
}

export async function networkAlarm(state: any, fetcher: FetchSource): Promise<boolean> {
  if (!await state.storage.get('network:task')) return false;
  await state.blockConcurrencyWhile(async () => {
    const task = await state.storage.get('network:task');
    if (!task || terminal.has(task.status)) return;
    if (task.expires_at < Date.now()) { task.status = 'FAILED'; task.verification_state = 'EXPIRED'; await state.storage.put('network:task', task); return; }
    const step = task.input.steps[task.current_step];
    if (!step) { task.status = 'FAILED'; task.verification_state = 'INVALID_CHECKPOINT'; await state.storage.put('network:task', task); return; }
    task.status = 'RUNNING'; task.attempts++; task.updated_at = iso();
    await state.storage.transaction(async (tx: any) => { await tx.put('network:task', task); await tx.setAlarm(Date.now() + 30000); });
    try {
      const url = task.attempts > 1 && step.fallback_url ? step.fallback_url : step.url;
      if (url !== step.url) task.provider_switches++;
      const result = await fetchPublic(url, fetcher);
      if (result.status !== step.expected_status) throw Object.assign(new Error(result.status === 429 ? 'provider_quota_exhausted' : 'acceptance_http_status_failed'), { code: result.status === 429 ? 'provider_quota_exhausted' : 'acceptance_http_status_failed', http_status: result.status });
      const data = step.kind === 'extract' ? extractDocument(typeof result.data === 'string' ? result.data : JSON.stringify(result.data), result.final_url) : { url: result.final_url, status: result.status };
      task.outputs.push({ run: task.current_run, step: task.current_step, data, digest: result.body_sha256, retrieved_at: result.source.retrieved_at });
      task.checkpoints.push({ checkpoint_id: crypto.randomUUID(), run: task.current_run, step: task.current_step, at: iso(), source_digest: result.body_sha256, verification: 'PASSED' });
      task.events.push({ at: iso(), type: 'task.checkpoint', step: task.current_step });
      task.current_step++; task.attempts = 0;
      let next = Date.now() + 1000;
      if (task.current_step === task.input.steps.length) {
        if (task.current_run < task.input.runs) { task.current_run++; task.current_step = 0; task.status = 'PENDING'; next = Date.now() + task.input.interval_seconds * 1000; }
        else { task.status = 'COMPLETED'; task.verification_state = 'PASSED'; task.completed_at = iso(); task.events.push({ at: iso(), type: 'task.completed' }); }
      } else task.status = 'PENDING';
      task.updated_at = iso();
      await state.storage.transaction(async (tx: any) => { await tx.put('network:task', task); if (task.status === 'COMPLETED') await tx.deleteAlarm(); else await tx.setAlarm(next); });
    } catch (error: any) {
      const code = /^[a-z_]{1,100}$/.test(error.code || '') ? error.code : 'provider_request_failed';
      task.failures.push({ run: task.current_run, step: task.current_step, attempt: task.attempts, code, at: iso(), http_status: error.http_status || null });
      task.status = task.attempts >= 3 ? 'FAILED' : code === 'provider_quota_exhausted' ? 'WAITING_FOR_QUOTA' : task.input.condition === 'http_healthy' ? 'WAITING_FOR_CAPACITY' : 'PENDING';
      task.verification_state = task.status === 'FAILED' ? 'FAILED' : 'PENDING'; task.updated_at = iso();
      if (task.status === 'FAILED') task.dead_letter = { code, step: task.current_step, attempts: task.attempts, at: iso(), remaining_routes: task.input.steps[task.current_step]?.fallback_url ? [] : ['Supply a new funded task with an approved fallback.'] };
      await state.storage.transaction(async (tx: any) => { await tx.put('network:task', task); if (task.status === 'FAILED') await tx.deleteAlarm(); else await tx.setAlarm(Date.now() + (code === 'provider_quota_exhausted' ? 60000 : 5000 * task.attempts)); });
    }
  });
  return true;
}
