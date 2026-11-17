import { definition, object, list, reference, number, text, subtotal, safeNumber } from './common.js';

const schema = object({ budget_micros: number(), spent_micros: number(), next_cost_micros: number(), repeat_limit: { ...number(20), minimum: 1 }, recent: list(object({ fingerprint: reference, output_sha256: { ...text(64), pattern: '^[a-f0-9]{64}$' } }), 100) });
export function burnDecision(input) {
  const last = input.recent.at(-1), repetitions = input.recent.filter(x => x.fingerprint === last.fingerprint && x.output_sha256 === last.output_sha256).length;
  const reasons = [];
  if (BigInt(input.spent_micros) + BigInt(input.next_cost_micros) > BigInt(input.budget_micros)) reasons.push('budget_exceeded');
  if (repetitions >= input.repeat_limit) reasons.push('repeated_identical_execution');
  return { allowed: reasons.length === 0, action: reasons.length ? 'STOP' : 'CONTINUE', reasons, exact_repeat_count: repetitions, remaining_micros: Math.max(0, input.budget_micros - input.spent_micros), prevented_next_cost_micros: reasons.length ? input.next_cost_micros : 0, realized_savings_micros: null, enforcement: 'Caller must enforce this decision before its next tool invocation. Fingerprints and costs are caller-supplied; semantic equivalence and actual savings are not independently established.' };
}
export const burnBreaker = definition('burn-breaker', 'Agent spend & loop decision', 'Evaluate an explicit spend cap and repeated identical execution fingerprints. Returns a STOP/CONTINUE decision; your runtime enforces it. No claimed semantic detection or verified savings.', schema, { budget_micros: 1000000, spent_micros: 950000, next_cost_micros: 100000, repeat_limit: 3, recent: [{ fingerprint: 'tool-call-1', output_sha256: 'a'.repeat(64) }] }, burnDecision);
