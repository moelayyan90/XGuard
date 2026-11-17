import { burnBreaker } from './burn-breaker.js';
import { contextCapsules } from './context-capsules.js';
import { domToApi } from './dom-to-api.js';
import { promptFirewall } from './prompt-firewall.js';
import { piiRedaction } from './pii-redaction.js';
import { leadGeneration } from './lead-generation.js';
import { governance } from './governance.js';
import { agentIam } from './agent-iam.js';
import { auditVault } from './audit-vault.js';
import { clearinghouse } from './clearinghouse.js';
import { dealAgents } from './deal-agents.js';
import { marketArbitrage } from './market-arbitrage.js';
import { latencyArbitrage } from './latency-arbitrage.js';
import { object, text, validate, digest, fail } from './common.js';
import deployment from '../../deployment-state.json' with { type: 'json' };

const modules = [burnBreaker, contextCapsules, domToApi, promptFirewall, piiRedaction, leadGeneration, governance, agentIam, auditVault, clearinghouse, dealAgents, marketArbitrage, latencyArbitrage];
export const productModule = id => modules.find(p => p.id === id || p.route === id) ?? null;
export const commerceSaleEnabled = () => deployment.payment_state_write_version >= 6;
export const PRODUCT_SERVICES = modules.map(({ execute, check, schema, ...definition }) => definition);
export function productSchema(route) {
  const p = productModule(route);
  return p ? object({ ...p.schema.properties, max_amount_atomic: { ...text(12), pattern: '^\\d{1,12}$' } }) : null;
}
export function normalizeProduct(route, raw) {
  const p = productModule(route);
  if (!p) throw fail('product_unavailable', 503);
  // Both human and agent payment paths share the same bounded input contract.
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 14000) throw fail('product_input_too_large', 413);
  validate(productSchema(route), raw);
  if (BigInt(raw.max_amount_atomic) < BigInt(p.amount)) throw fail('buyer_budget_too_small', 400);
  const { max_amount_atomic, ...input } = raw;
  p.check(input);
  return { capability: p.id, ...input, max_amount_atomic };
}
export async function executeProduct(input) {
  const p = productModule(input.capability);
  if (!p) throw fail('product_unavailable', 503);
  const { capability, idempotency_key, ...raw } = input;
  const normalized = normalizeProduct(p.route, raw);
  const started = performance.now(), data = { service: p.id, ...await p.execute(normalized), scope: p.description };
  const body = JSON.stringify(data), bytes = new TextEncoder().encode(body).length;
  if (bytes > 100000) throw fail('product_result_too_large', 422);
  return { data, status: 200, final_url: 'https://api.xguardgate.com/api/paid/v1/' + p.route, body_sha256: await digest(body), body_bytes: bytes, content_type: 'application/json', latency_ms: Math.ceil(performance.now() - started), verification: { content_truth_verified: false, source: 'Customer-supplied input; deterministic bounded XGuard transformation', external_requests: 0 } };
}
