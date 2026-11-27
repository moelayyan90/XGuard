import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from '../../../packages/agent-verifier/fixtures.mjs';

test('official MCP client discovers only inspection tools and verifies both artifacts via stdio', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'open-verifier-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture(), config = join(dir, 'policy.json');
  await writeFile(config, JSON.stringify(f.policy));
  const cli = fileURLToPath(new URL('../../../packages/agent-verifier/cli.mjs', import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', config] });
  const client = new Client({ name: 'open-verifier-test', version: '1' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(x => x.name), ['review_offer', 'verify_receipt']);
    assert.ok(tools.every(x => x.annotations.readOnlyHint));
    const review = await client.callTool({ name: 'review_offer', arguments: f.offerInput });
    assert.equal(JSON.parse(review.content[0].text).status, 'reviewed');
    const receipt = await client.callTool({ name: 'verify_receipt', arguments: f.receiptInput });
    assert.equal(JSON.parse(receipt.content[0].text).status, 'merchant_receipt_verified');
    f.offerInput.challenge.accepts[0].amount = '1';
    const denied = await client.callTool({ name: 'review_offer', arguments: f.offerInput });
    assert.equal(denied.isError, true);
    await assert.rejects(client.callTool({ name: 'consume', arguments: {} }));
  } finally { await client.close(); }
});
