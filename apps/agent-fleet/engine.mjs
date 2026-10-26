import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { LocalModel } from './model.mjs';

export const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
export function localKey() {
  const path = join(APP_DIR, '.runtime/model.key');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
}

export async function startEngine({ port = 8080 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid model port');
  await new Promise((resolveFree, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('The local model port is already occupied; an existing process will not be adopted')));
    probe.listen({ host: '127.0.0.1', port }, () => probe.close(error => error ? reject(error) : resolveFree()));
  });
  const root = join(APP_DIR, '.runtime'), manifestPath = join(root, 'installed.json');
  if (!existsSync(manifestPath) || !localKey()) throw new Error('Local inference is not installed. Run python3 apps/agent-fleet/scripts/setup-local.py first.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const logPath = join(root, 'model.log');
  const log = openSync(logPath, 'a', 0o600);
  const child = spawn(manifest.engine, ['--model', manifest.model, '--host', '127.0.0.1', '--port', String(port),
    '--ctx-size', '16384', '--parallel', '4', '--threads', '4', '--jinja', '--reasoning', 'off',
    '--cache-ram', '256',
    '--api-key-file', join(root, 'model.key'), '--cors-origins', 'localhost', '--no-agent', '--no-ui', '--log-verbosity', '1'],
  { stdio: ['ignore', log, log], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } });
  closeSync(log);
  let startupError;
  child.on('error', error => { startupError = error; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill('SIGINT');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(4000)]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  };
  const model = new LocalModel({ baseUrl: `http://127.0.0.1:${port}`, apiKey: localKey() });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || child.exitCode !== null || child.signalCode) { await stop(); throw new Error('Local model process could not start; inspect the private model log'); }
    if ((await model.health()).reachable) return { child, model, stop, modelId: manifest.model_id, modelSha256: manifest.model_sha256 };
    await delay(200);
  }
  await stop(); throw new Error('Local model startup timed out');
}
