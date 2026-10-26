import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalModel, ModelError, localModelUrl, validateAction } from '../model.mjs';

const messages = [{ role: 'user', content: 'Produce a small verified fixture. This is not a paid request.' }];
const isCode = expected => error => error instanceof ModelError && error.code === expected;
const actionResponse = (action = { action: 'finish', text: 'Fixture output' }, finishReason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(action) } }] }), { status: 200 });

test('model URLs are confined to local HTTP endpoints, including localhost and IPv6 loopback', () => {
  assert.equal(localModelUrl(), 'http://127.0.0.1:8080');
  for (const url of ['http://127.0.0.1:8080/', 'http://localhost:8081', 'http://[::1]:8082']) {
    assert.equal(localModelUrl(url), new URL(url).origin);
  }
  for (const url of [
    'https://127.0.0.1:8080', 'http://192.168.1.1:8080', 'http://0.0.0.0:8080',
    'http://example.com', 'https://api.openai.com', 'http://localhost.example.com',
    'http://user:fixture@127.0.0.1:8080', 'http://127.0.0.1:8080/?token=fixture',
    'http://127.0.0.1:8080/#fragment', 'http://127.0.0.1:8080/v1', 'not a URL',
  ]) assert.throws(() => localModelUrl(url), isCode('invalid_model_url'), url);
});

test('credentials cannot be sent to a remote inference URL', () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Must never be called'); };
  for (const baseUrl of ['https://api.example.com', 'http://example.com', 'http://127.0.0.1.example.com']) {
    assert.throws(() => new LocalModel({ baseUrl, apiKey: 'local_fixture_key_123456789', fetchImpl }), isCode('invalid_model_url'));
  }
  assert.equal(calls, 0);
  for (const apiKey of ['', 'short', 'local key with spaces and more than 24 chars', 'a'.repeat(129)]) {
    assert.throws(() => new LocalModel({ apiKey, fetchImpl }), isCode('invalid_local_key'));
  }
});

test('local authentication headers and disabled redirects apply to health and generation only on loopback', async () => {
  const calls = [], apiKey = 'local_test_fixture_key_123456789';
  const model = new LocalModel({ baseUrl: 'http://[::1]:8080', apiKey, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/health') ? new Response('{"status":"ok"}') : actionResponse();
  } });
  assert.deepEqual(await model.health(), { reachable: true, kind: 'local-llama-cpp', paidApiCalls: 0 });
  assert.deepEqual(await model.complete({ messages, maxTokens: 32 }), { action: 'finish', text: 'Fixture output' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).hostname, '[::1]');
    assert.equal(call.init.headers.authorization, `Bearer ${apiKey}`);
    assert.equal(call.init.redirect, 'error');
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  const request = JSON.parse(calls[1].init.body);
  assert.equal(request.max_tokens, 32); assert.equal(request.stream, false);
  assert.equal(request.chat_template_kwargs.enable_thinking, false);
  assert.equal(request.response_format.type, 'json_object');
});

test('structured actions reject unknown fields, missing values, prototype action names and executable commands', () => {
  const valid = [
    { action: 'finish', text: 'A completed local fixture' },
    { action: 'write_file', path: 'evidence.txt', content: '' },
    { action: 'read_file', path: 'evidence.txt' },
    { action: 'web_get', url: 'https://docs.example.com/' },
  ];
  for (const value of valid) assert.deepEqual(validateAction(value), value);
  for (const value of [
    null, [], 'finish', {}, { action: 'shell', command: 'not executed' },
    { action: 'constructor' }, { action: '__proto__' }, { action: 'toString' },
    { action: 'finish' }, { action: 'finish', text: '' }, { action: 'finish', text: 'ok', payment: 'invented' },
    { action: 'read_file', path: 'a.txt', content: 'unexpected' },
    { action: 'write_file', path: '', content: 'data' },
    { action: 'write_file', path: 'a.txt', content: 1 },
    { action: 'write_file', path: 'a.txt', content: 'a'.repeat(65537) },
  ]) assert.throws(() => validateAction(value), isCode('invalid_model_action'), JSON.stringify(value).slice(0, 150));
});

test('request limits and invalid allowedActions are rejected before invoking the model', async () => {
  let calls = 0;
  const model = new LocalModel({ fetchImpl: async () => { calls++; return actionResponse(); } });
  for (const request of [
    {}, { messages: [] }, { messages: Array(33).fill(messages[0]) },
    { messages: [{ role: 'user', content: 'x'.repeat(50000) }] },
    { messages, maxTokens: 0 }, { messages, maxTokens: 1025 }, { messages, maxTokens: 32.5 },
    { messages, allowedActions: [] }, { messages, allowedActions: ['shell'] },
  ]) await assert.rejects(() => model.complete(request), isCode('invalid_model_request'));
  assert.equal(calls, 0);
});

test('allowedActions restricts both the requested schema and the model action actually returned', async () => {
  const requests = [];
  const model = new LocalModel({ fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return actionResponse({ action: 'write_file', path: 'not-permitted.txt', content: 'Must not execute' });
  } });
  await assert.rejects(() => model.complete({ messages, allowedActions: ['finish'] }), isCode('invalid_model_action'));
  assert.deepEqual(requests[0].response_format.schema.oneOf.map(option => option.properties.action.const), ['finish']);
  const allowed = new LocalModel({ fetchImpl: async () => actionResponse({ action: 'finish', text: 'Final step' }) });
  assert.equal((await allowed.complete({ messages, allowedActions: ['finish'] })).action, 'finish');
});

test('empty reasoning tags are accepted but malformed JSON and unexpected response shapes fail closed', async () => {
  const valid = new LocalModel({ fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '<think>\n</think>\n{"action":"finish","text":"verified"}' } }] })) });
  assert.equal((await valid.complete({ messages })).text, 'verified');
  for (const response of [new Response('<html>not JSON</html>'), new Response('{}'), new Response('{"choices":[]}'), new Response('{"choices":[{"message":{"content":null}}]}')]) {
    const model = new LocalModel({ fetchImpl: async () => response });
    await assert.rejects(() => model.complete({ messages }), isCode('invalid_model_response'));
  }
  for (const content of ['not JSON', '{"action":"shell","command":"not executed"}', '{"action":"finish","text":"fixture","unexpected":true}']) {
    const model = new LocalModel({ fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })) });
    await assert.rejects(() => model.complete({ messages }), isCode('invalid_model_action'));
  }
});

test('token-truncated and huge streamed responses are never treated as successful output', async () => {
  const truncated = new LocalModel({ fetchImpl: async () => actionResponse({ action: 'finish', text: 'Looks complete but was truncated' }, 'length') });
  await assert.rejects(() => truncated.complete({ messages }), isCode('model_output_truncated'));
  const huge = new LocalModel({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(131072)); controller.enqueue(new Uint8Array(131073)); controller.close();
  } })) });
  await assert.rejects(() => huge.complete({ messages }), isCode('model_response_too_large'));
});

test('offline, HTTP failure and cancelled local model calls have explicit failure states', async () => {
  const offline = new LocalModel({ fetchImpl: async () => { throw new TypeError('Fixture connection refused'); } });
  await assert.rejects(() => offline.complete({ messages }), error => isCode('model_unavailable')(error) && error.blocked && error.retryable);
  assert.deepEqual(await offline.health(), { reachable: false, kind: 'local-llama-cpp', paidApiCalls: 0 });
  for (const status of [429, 503]) {
    const model = new LocalModel({ fetchImpl: async () => new Response('Unavailable fixture', { status }) });
    await assert.rejects(() => model.complete({ messages }), error => isCode('model_http_error')(error) && error.blocked);
  }
  const abort = new AbortController(); abort.abort();
  const cancelled = new LocalModel({ fetchImpl: async (_url, init) => { init.signal.throwIfAborted(); return actionResponse(); } });
  await assert.rejects(() => cancelled.complete({ messages, signal: abort.signal }), error => isCode('cancelled')(error) && error.blocked && error.retryable);
});

test('cancellation after response headers remains a cancelled model failure', async () => {
  const abort = new AbortController();
  const model = new LocalModel({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"choices":['));
    abort.abort(); controller.error(new DOMException('Fixture cancelled stream', 'AbortError'));
  } })) });
  await assert.rejects(() => model.complete({ messages, signal: abort.signal }), error => isCode('cancelled')(error) && error.blocked);
});

test('a disconnected response body remains an explicit blocked, retryable interruption', async () => {
  const model = new LocalModel({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    controller.error(new TypeError('Fixture connection dropped after headers'));
  } })) });
  await assert.rejects(() => model.complete({ messages }), error => isCode('model_response_interrupted')(error) && error.blocked && error.retryable);
});
