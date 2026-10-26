/** Real, bounded local inference qualification. This is not a sale or a market-demand test. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAgentCatalog } from '../catalog.mjs';
import { FleetStore } from '../store.mjs';
import { FleetTools } from '../tools.mjs';
import { runBatch } from '../runtime.mjs';
import { startEngine, APP_DIR } from '../engine.mjs';
import { startServer } from '../server.mjs';

const count = Number(process.argv[2] ?? 2000);
if (!Number.isInteger(count) || count < 1 || count > 2000) throw new Error('Choose 1–2000 agent profiles');
const state = resolve(process.env.FLEET_STATE_DIR ?? join(APP_DIR, '.state'));
mkdirSync(state, { recursive: true, mode: 0o700 });
const store = new FleetStore(join(state, 'fleet.sqlite'));
store.seed(createAgentCatalog(2000));
const instruction = 'Initial capability check, not a commercial sale. For your specialty and sector, name ONE digital deliverable and ONE check in a very short Arabic line (at most 80 characters), using التسليم: and التحقق:. No web requests, purchases, demand or revenue claims. Finish directly.';
for (const agent of store.listAgents({ limit: count })) {
  store.createJob({ agentId: agent.id, instruction, idempotencyKey: `local-qualification-v2:${agent.id}`, maxSteps: 1, maxOutputTokens: 160 });
}
const controller = new AbortController();
process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
let engine, tools, ui, interval;
const startedAt = new Date().toISOString(), begin = performance.now();
let peakActive = 0, maxModelRssBytes = 0;
function checkpoint(extra = {}) {
  const stats = store.stats(); peakActive = Math.max(peakActive, stats.activeLeases);
  try {
    const status = readFileSync(`/proc/${engine.child.pid}/status`, 'utf8');
    maxModelRssBytes = Math.max(maxModelRssBytes, Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024);
  } catch { /* A terminated engine is reported separately and never implies success. */ }
  const value = { kind: 'actual_local_inference_qualification', startedAt, checkedAt: new Date().toISOString(),
    elapsedSeconds: Math.round((performance.now() - begin) / 1000), assignedProfiles: count, peakActive, maxModelRssBytes, stats,
    paidApiCalls: 0, externalWebReads: 0, moneyMoved: false, saleProven: false, ...extra };
  writeFileSync(join(state, 'qualification-progress.json'), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return value;
}
try {
  engine = await startEngine(); tools = new FleetTools({ root: join(state, 'artifacts'), allowedDomains: [] });
  const model = { complete: options => engine.model.complete({ ...options, maxTextChars: 80 }) };
  ui = await startServer({ store, runBatch: options => runBatch({ store, model, tools, ...options, signal: controller.signal }), pause: () => controller.abort(), port: 8790, modelHealth: () => engine.model.health() });
  console.log(JSON.stringify({ qualificationStarted: true, model: engine.modelId, profiles: count, localDashboard: ui.url, paidApiCalls: 0 }));
  interval = setInterval(() => { const data = checkpoint(); console.log(JSON.stringify({ completed: data.stats.done, failed: data.stats.failed, blocked: data.stats.blocked, queued: data.stats.queued, active: data.stats.activeLeases, elapsedSeconds: data.elapsedSeconds })); }, 15000);
  const outcome = await runBatch({ store, model, tools, concurrency: 4, limit: count, signal: controller.signal });
  clearInterval(interval);
  const jobs = store.listJobs({ limit: 10000 }).filter(j => j.idempotencyKey.startsWith('local-qualification-v2:'));
  const withBothFields = jobs.filter(j => j.status === 'done' && j.result.text.includes('التسليم') && j.result.text.includes('التحقق')).length;
  const report = checkpoint({ finishedAt: new Date().toISOString(), outcome, model: engine.modelId, modelSha256: engine.modelSha256,
    engineExitSignalBeforeCleanup: engine.child.signalCode, engineExitCodeBeforeCleanup: engine.child.exitCode,
    outputQuality: { includesBothRequestedFieldLabels: withBothFields, substantiveCorrectnessIndependentlyValidated: false },
    sample: jobs.filter(j => j.status === 'done').slice(0, 10).map(j => ({ agentId: j.agentId, text: j.result.text, artifacts: j.result.artifacts })),
    scope: 'Each completed record required an actual local LLM response and a stored artifact. This qualification is not external work, a sale, permanent hosting, or commercial validation.' });
  writeFileSync(join(state, 'qualification-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ qualificationFinished: true, outcome, done: report.stats.done, elapsedSeconds: report.elapsedSeconds, peakActive, labelChecks: withBothFields, saleProven: false }));
} finally {
  clearInterval(interval); controller.abort(); await ui?.close(); await engine?.stop(); tools?.close();
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); store.close();
}
