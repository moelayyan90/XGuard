import { once } from 'node:events';
import { reviewOffer, reviewReceipt } from './verify.mjs';

const object = { type: 'object' };
const methods = new Map([
  ['review_offer', { run: reviewOffer, description: 'Review one signed x402 offer under the local policy.', fields: ['request', 'challenge'] }],
  ['verify_receipt', { run: reviewReceipt, description: 'Verify a merchant receipt against expected payer and transaction.', fields: ['expected', 'settlement'] }],
]);
const tools = Array.from(methods, ([name, method]) => ({
  name, description: method.description,
  inputSchema: { type: 'object', properties: Object.fromEntries(method.fields.map(f => [f, object])),
    required: method.fields, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
}));
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function safeReason(error) {
  return /^[a-z][a-z_]{1,65}$/.test(error?.message) ? error.message : 'invalid_input';
}

function respond(policy, msg, session) {
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return failure(null, -32600, 'Invalid request');
  if (!Object.hasOwn(msg, 'id')) return null;
  const id = msg.id;
  if (typeof id !== 'string' && !Number.isSafeInteger(id)) return failure(null, -32600, 'Invalid request id');
  const ok = result => ({ jsonrpc: '2.0', id, result });
  if (msg.method === 'initialize') {
    if (typeof msg.params?.protocolVersion !== 'string') return failure(id, -32602, 'Missing protocol version');
    session.initialized = true;
    return ok({ protocolVersion: versions.includes(msg.params.protocolVersion) ? msg.params.protocolVersion : versions[0],
      capabilities: { tools: {} }, serverInfo: { name: 'xguard-open-verifier', version: '0.1.0' } });
  }
  if (msg.method === 'ping') return ok({});
  if (!session.initialized) return failure(id, -32002, 'Initialize first');
  if (msg.method === 'tools/list') return ok({ tools });
  if (msg.method !== 'tools/call') return failure(id, -32601, 'Unknown method');
  const method = methods.get(msg.params?.name);
  if (!method) return failure(id, -32602, 'Unknown tool');
  const args = msg.params.arguments;
  if (!args || Object.keys(args).length !== method.fields.length || !method.fields.every(f => Object.hasOwn(args, f)))
    return failure(id, -32602, 'Invalid arguments');
  try {
    const result = method.run(policy, args);
    return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (error) {
    return ok({ isError: true, content: [{ type: 'text', text: safeReason(error) }] });
  }
}

export async function serve(policy, input = process.stdin, output = process.stdout) {
  const session = { initialized: false };
  const maxFrame = 256 * 1024;
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    let rest = Buffer.from(chunk);
    while (rest.length) {
      const end = rest.indexOf(10);
      const part = end < 0 ? rest : rest.subarray(0, end);
      if (pending.length + part.length > maxFrame) throw new Error('frame_too_large');
      pending = Buffer.concat([pending, part]);
      if (end < 0) break;
      rest = rest.subarray(end + 1);
      let response;
      try {
        response = respond(policy, JSON.parse(pending.toString('utf8')), session);
      } catch {
        response = failure(null, -32700, 'Invalid JSON');
      }
      pending = Buffer.alloc(0);
      if (response && !output.write(JSON.stringify(response) + '\n')) await once(output, 'drain');
    }
  }
}
