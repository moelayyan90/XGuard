import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fixture } from './fixtures.mjs';

const run = promisify(execFile);
const sample = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : fixture();
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'xguard-goose-'));
const policyPath = join(directory, 'policy.json');
const prefix = 'xguard_open_verifier__';
const results = {};
let discovered = false;

function readToolContent(content) {
  if (typeof content === 'string') {
    try { return readToolContent(JSON.parse(content)); } catch { return undefined; }
  }
  if (Array.isArray(content)) return content.map(readToolContent).find(Boolean);
  if (content?.status) return content;
  if (content?.text) return readToolContent(content.text);
}

// A deterministic local model peer asks goose to call the real extension and
// checks the returned tool message. The peer never contacts a model provider.
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  try {
    let raw = '';
    for await (const part of req) raw += part;
    const { tools = [], messages = [], stream } = JSON.parse(raw);
    discovered ||= ['review_offer', 'verify_receipt'].every(name => tools.some(t => t.function?.name === prefix + name));
    for (const msg of messages.filter(m => m.role === 'tool')) {
      const result = readToolContent(msg.content);
      if (msg.tool_call_id === 'call_offer' && result?.status === 'reviewed') results.offer = result;
      if (msg.tool_call_id === 'call_receipt' && result?.status === 'merchant_receipt_verified') results.receipt = result;
    }
    const kind = results.offer ? 'receipt' : 'offer';
    const call = { id: 'call_' + kind, type: 'function', function: {
      name: prefix + (kind === 'offer' ? 'review_offer' : 'verify_receipt'),
      arguments: JSON.stringify(sample[kind + 'Input']) } };
    const useTool = discovered && !results.receipt;
    const message = useTool ? { role: 'assistant', content: null, tool_calls: [call] }
      : { role: 'assistant', content: 'Fixture complete.' };
    const finish = useTool ? 'tool_calls' : 'stop';
    const base = { id: 'chatcmpl-fixture', model: 'gpt-4o', created: Math.floor(Date.now() / 1000) };
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (useTool) call.index = 0;
      for (const [delta, reason] of [[message, null], [{}, finish]]) {
        const chunk = { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: reason }] };
        res.write('data: ' + JSON.stringify(chunk) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base,
        object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  } catch { res.writeHead(400).end(); }
});

try {
  await writeFile(policyPath, JSON.stringify(sample.policy), { mode: 0o600 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = { PATH: process.env.PATH, XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'), XDG_CACHE_HOME: join(directory, 'cache'),
    GOOSE_DISABLE_KEYRING: '1', GOOSE_TELEMETRY_ENABLED: 'false', GOOSE_MODE: 'auto',
    GOOSE_PROVIDER: 'openai', GOOSE_MODEL: 'gpt-4o', OPENAI_API_KEY: 'local-fixture-only',
    OPENAI_HOST: 'http://127.0.0.1:' + server.address().port, OPENAI_BASE_PATH: 'v1/chat/completions',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
    XGUARD_VERIFIER_POLICY: policyPath };
  await run(process.argv[2] || 'goose', ['run', '--no-session', '--max-turns', '5', '--recipe',
    join(root, 'packages/agent-verifier/goose.yaml')], { cwd: root, env, timeout: 30000 });
  assert.ok(discovered, 'goose did not discover the verifier');
  assert.ok(results.offer?.requestHash && results.receipt?.receiptHash, 'goose did not return both verifier results');
  console.log(process.argv[3] ? JSON.stringify(results) : 'goose verified the fixture offer and receipt through MCP.');
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
