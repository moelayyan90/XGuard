#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentCatalog } from './catalog.mjs';
import { FleetStore } from './store.mjs';
import { FleetTools } from './tools.mjs';
import { LocalModel } from './model.mjs';
import { runBatch } from './runtime.mjs';
import { startServer } from './server.mjs';
import { APP_DIR, localKey, startEngine } from './engine.mjs';

const FLAGS = new Set(['state', 'count', 'agent', 'task', 'key', 'limit', 'concurrency', 'port', 'model-url', 'allow-domains', 'max-steps', 'max-output-tokens', 'role', 'sector', 'market', 'offset', 'job', 'watch', 'with-model']);
export function parseArgs(args) {
  const command = args[0] ?? 'help', flags = {};
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--') || !FLAGS.has(token.slice(2)) || token.slice(2) in flags) throw new Error(`Unknown or repeated option ${token}`);
    const key = token.slice(2);
    if (key === 'watch' || key === 'with-model') flags[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = value;
    }
  }
  return { command, flags };
}
function num(flags, name, fallback, min, max) {
  const value = flags[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`--${name} must be ${min}–${max}`);
  return Number(value);
}
const output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

export async function main(args = process.argv.slice(2)) {
  const { command, flags } = parseArgs(args);
  if (command === 'help') {
    output({ name: 'XGuard Agent Fleet', commands: ['init --count 2000', 'status', 'agents --limit 25', 'enqueue --agent agent-000001 --task "..."', 'assign --task "..." --limit 2000', 'run --limit 10 --concurrency 4', 'serve --with-model --watch --port 8790', 'model-start --port 8080', 'retry --job job-...'],
      model: 'Local llama.cpp only; no paid provider API', earnings: 'Unproven; worker/task counts are not income' }); return;
  }
  if (command === 'model-start') {
    const engine = await startEngine({ port: num(flags, 'port', 8080, 1, 65535) });
    output({ modelReady: true, provider: 'local-llama-cpp', model: engine.modelId, paidApiCalls: 0 });
    const stop = async () => { await engine.stop(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  const state = resolve(flags.state ?? process.env.FLEET_STATE_DIR ?? join(APP_DIR, '.state'));
  const store = new FleetStore(join(state, 'fleet.sqlite'));
  if (command === 'init') { try { output(store.seed(createAgentCatalog(num(flags, 'count', 2000, 1, 10000)))); } finally { store.close(); } return; }
  if (command === 'status') { try { output(store.stats()); } finally { store.close(); } return; }
  if (command === 'agents') { try { output(store.listAgents({ limit: num(flags, 'limit', 25, 1, 10000), offset: num(flags, 'offset', 0, 0, 10000), ...(flags.role ? { role: flags.role } : {}) })); } finally { store.close(); } return; }
  if (command === 'enqueue' || command === 'assign') {
    try {
      if (!flags.task) throw new Error('--task is required');
      const limits = { maxSteps: num(flags, 'max-steps', 4, 1, 8), maxOutputTokens: num(flags, 'max-output-tokens', 256, 32, 1024) };
      const key = flags.key ?? randomUUID();
      if (typeof key !== 'string' || key.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(key)) throw new Error('Assignment keys must be 1–100 safe characters');
      if (command === 'enqueue') {
        if (!flags.agent) throw new Error('--agent is required');
        output(store.createJob({ agentId: flags.agent, instruction: flags.task, idempotencyKey: key, ...limits }));
      } else {
        const agents = store.listAgents({ limit: 10000, ...(flags.role ? { role: flags.role } : {}) })
          .filter(a => (!flags.sector || a.sector === flags.sector) && (!flags.market || a.market === flags.market))
          .slice(0, num(flags, 'limit', 2000, 1, 2000));
        const jobs = agents.map(agent => store.createJob({ agentId: agent.id, instruction: flags.task, idempotencyKey: `${key}:${agent.id}`, ...limits }));
        output({ assigned: jobs.length, assignmentKey: key, queued: store.stats().queued, note: 'Assignment is not completion or income' });
      }
    } finally { store.close(); }
    return;
  }
  if (command === 'retry') { try { output(store.retry(flags.job)); } finally { store.close(); } return; }
  if (!['run', 'serve'].includes(command)) { store.close(); throw new Error(`Unknown command ${command}`); }
  let engine, tools;
  const controller = new AbortController();
  try {
    const modelUrl = flags['model-url'] ?? process.env.FLEET_MODEL_URL ?? 'http://127.0.0.1:8080';
    if (flags['with-model']) {
      const url = new URL(modelUrl);
      if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.pathname !== '/') throw new Error('--with-model requires http://127.0.0.1:<port>');
      engine = await startEngine({ port: Number(url.port || 80) });
    }
    const model = new LocalModel({ baseUrl: modelUrl, apiKey: localKey() });
    const allowedDomains = (flags['allow-domains'] ?? process.env.FLEET_ALLOWED_DOMAINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    tools = new FleetTools({ root: join(state, 'artifacts'), allowedDomains });
    const concurrency = num(flags, 'concurrency', 4, 1, 4);
    if (command === 'run') {
      const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
      output(await runBatch({ store, model, tools, signal: controller.signal, concurrency, limit: num(flags, 'limit', 10, 1, 2000) }));
      process.off('SIGINT', stop); process.off('SIGTERM', stop); return;
    }
    let active, batchAbort, watchPaused = false;
    const run = async options => {
      watchPaused = false; batchAbort = new AbortController();
      active = runBatch({ store, model, tools, ...options, signal: AbortSignal.any([batchAbort.signal, controller.signal]) });
      try {
        const result = await active;
        if (result.blocked > 0 && result.completed === 0) { watchPaused = true; return { ...result, schedulingPaused: true }; }
        return result;
      } finally { active = undefined; }
    };
    const ui = await startServer({ store, runBatch: run, pause: () => { watchPaused = true; batchAbort?.abort(); }, port: num(flags, 'port', 8790, 1, 65535), modelHealth: () => model.health() });
    output({ localUrl: ui.url, registeredAgents: store.stats().agents, model: await model.health(), watch: Boolean(flags.watch), revenue: 'unproven' });
    let watcher;
    if (flags.watch) watcher = setInterval(async () => {
      if (watchPaused || active || !store.stats().queued) return;
      if (!(await model.health()).reachable) return;
      try { await fetch(`${ui.url}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: Math.min(store.stats().queued, 100), concurrency }), signal: AbortSignal.timeout(3000) }); }
      catch { /* The next bounded tick retries scheduling; tasks remain durable. */ }
    }, 3000);
    await new Promise(resolveDone => {
      const stop = () => { controller.abort(); resolveDone(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
    clearInterval(watcher); await active?.catch(() => {}); await ui.close();
  } finally { tools?.close(); store.close(); await engine?.stop(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.code ?? 'fleet_error'}: ${error.message}\n`); process.exitCode = 1; });
}
