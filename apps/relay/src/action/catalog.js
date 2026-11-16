import { LIVE_PAID, normalizeLivePaid, livePaidCapacity, executeLivePaid } from '../live/paid-data.ts';
import { cleanCsv, normalizeCsv, CSV_LIMITS } from './csv.js';
import { fail, digest } from '../compute/common.js';
import { networkRpc } from '../network/engine.ts';

const csv = { id: 'csv-clean', route: 'csv-clean', name: 'Clean & deduplicate a CSV', description: 'Trim whitespace, remove empty rows, separate exact duplicates and download clean CSV plus a change report. No AI guesses or external data transfers.', amount: '2000000', example: { csv: 'email,name\nhello@example.com, Alice \nhello@example.com,Alice\n', key_columns: ['email'] }, limits: CSV_LIMITS };
// One registry: new eligible LIVE_PAID services inherit checkout automatically.
// Card prices have a $2 minimum; legacy x402 micropayment prices are preserved.
export function actionCatalog() {
  return [csv, ...LIVE_PAID.map(d => ({ ...d, card_amount_cents: Math.max(200, Math.ceil(Number(d.amount) / 10000)), legacy_x402_url: '/api/paid/v1/' + d.route }))].map(d => ({ ...d, card_amount_cents: d.card_amount_cents ?? 200, currency: 'USD', checkout_url: '/checkout?service=' + d.id, execution: 'bounded', output: d.id === csv.id ? 'clean.csv, duplicates.csv, report.json' : 'JSON result and signed receipt' }));
}
export function actionProduct(id) { return actionCatalog().find(p => p.id === id) || null; }
export function normalizeAction(service, raw) {
  const product = actionProduct(service);
  if (!product) throw fail('unsupported_action_service', 422);
  const input = service === csv.id ? normalizeCsv(raw) : normalizeLivePaid(product.route, { ...raw, max_amount_atomic: product.amount });
  return { product, input };
}
export async function actionPreflight(env, service, input) {
  if (service !== csv.id) await livePaidCapacity(env, input);
}
export async function executeAction(env, q, fetchSource) {
  if (q.service === csv.id) return cleanCsv(q.input);
  if (q.workflow) return { workflow: q.workflow, progress: await networkRpc(env, q.workflow.task_id, 'status', { token: q.workflow.task_token }) };
  const r = await executeLivePaid(q.input, env, fetchSource, { payment_identifier: q.id });
  if (['network-task', 'network-schedule'].includes(q.service)) return { workflow: { task_id: r.data.task_id, task_token: r.data.task_token }, progress: r.data };
  return { data: r.data, verification: r.verification ?? null };
}
export async function actionFingerprint(service, input) { return digest({ service, input }); }
