import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { startEngine } from '../engine.mjs';

test('engine rejects an occupied loopback port rather than adopting an unrelated process', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  try { await assert.rejects(startEngine({ port: server.address().port }), /already occupied/); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test('engine validates its bind port before starting any process', async () => {
  for (const port of [0, -1, 65536, NaN, 1.2, '8080']) await assert.rejects(startEngine({ port }), /Invalid model port/);
});
