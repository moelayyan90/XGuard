import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import app from './canonical-entry.js';
import { NAME, PRODUCT, PRODUCT_SLUG, DESCRIPTION, REGISTRY_DESCRIPTION, VERSION } from './core/identity.js';

test('the API, A2A, OpenAPI and distribution manifests share one overall identity', async () => {
  for (const path of ['/identity', '/', '/v1/capabilities', '/openapi.json', '/.well-known/agent-card.json']) {
    const response = await app.fetch(new Request(`https://api.xguardgate.com${path}`), {}, {});
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-xguard-primary-product'), PRODUCT_SLUG, path);
    const body = await response.json();
    assert.equal(body.name || body.info.title, NAME, path);
    assert.equal(body.description || body.info.description, DESCRIPTION, path);
    if (body.primary_product) assert.equal(body.primary_product, PRODUCT, path);
    if (body.paid_api_gateway) assert.equal(body.paid_api_gateway.product, 'Paid API Gateway', 'seller APIs are a component, not a conflicting identity');
  }
  const manifest = await (await app.fetch(new Request('https://api.xguardgate.com/server.json'), {}, {})).json();
  const disk = JSON.parse(await readFile(new URL('../../../server.json', import.meta.url)));
  assert.equal(manifest.title, disk.title); assert.equal(disk.title, NAME);
  assert.equal(manifest.description, REGISTRY_DESCRIPTION); assert.equal(disk.description, REGISTRY_DESCRIPTION);
  assert.ok(REGISTRY_DESCRIPTION.length <= 100);
  for (const file of ['package.json', 'plugin.json']) {
    const value = JSON.parse(await readFile(new URL(`../../../${file}`, import.meta.url)));
    assert.equal(value.description, REGISTRY_DESCRIPTION); assert.equal(value.version, VERSION);
  }
});
test('published schema describes the real mandatory ticket, forecast policy, halt and recover APIs', async () => {
  const response = await app.fetch(new Request('https://api.xguardgate.com/openapi.json'), {}, {});
  const spec = await response.json();
  for (const path of ['/v1/egress/authorize', '/v1/secretless/authorize', '/v1/egress/halt', '/v1/egress/governance-status', '/v1/egress/recover']) assert.ok(spec.paths[path]?.post, path);
  assert.ok(spec.paths['/v1/egress/fetch'].post.requestBody.content['application/json'].schema.properties.governance_authorization);
  const policy = spec.paths['/v1/egress/capabilities'].post.requestBody.content['application/json'].schema.properties.governance;
  assert.ok(spec.paths['/v1/egress/capabilities'].post.requestBody.content['application/json'].schema.required.includes('governance'));
  assert.equal(policy.additionalProperties, false);
  assert.equal(policy.properties.forecasts.items.properties.success_probability_bps.maximum, 10000);
  assert.equal(spec['x-governance'].financial_trading_adapter, false);
  assert.equal(spec['x-governance'].mode, 'mandatory_external_capability_governance');
  await SwaggerParser.validate(spec);
});
