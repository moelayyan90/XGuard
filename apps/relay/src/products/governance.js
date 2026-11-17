import { definition, object, list, reference, number, text, iso } from './common.js';

export const policySchema = object({ actor: reference, tool: reference, resource: reference, cost_micros: number(), now: text(30), policy: object({ actors: list(reference, 20), tools: list(reference, 20), resources: list(reference, 20), max_cost_micros: number(), expires_at: text(30), approval_required: { type: 'boolean' } }) });
export function policyDecision(input) {
  const reasons = [];
  for (const [field, values] of [['actor', 'actors'], ['tool', 'tools'], ['resource', 'resources']]) if (!input.policy[values].includes(input[field])) reasons.push(field + '_denied');
  if (Date.parse(input.now) >= Date.parse(input.policy.expires_at)) reasons.push('policy_expired');
  if (input.cost_micros > input.policy.max_cost_micros) reasons.push('cost_limit');
  if (input.policy.approval_required) reasons.push('human_approval_required');
  return { allowed: reasons.length === 0, decision: reasons.length ? 'DENY' : 'ALLOW_WITHIN_DECLARED_POLICY', reasons, grants_credentials: false, executes_tool: false, scope: 'Evaluation of caller-supplied policy at caller-supplied time. This result is not an identity attestation, credential, sandbox or government compliance certification. Enforce it in your runtime.' };
}
export const policyExample = { actor: 'agent-1', tool: 'read-fact', resource: 'public-data', cost_micros: 5000, now: '2026-11-17T00:00:00Z', policy: { actors: ['agent-1'], tools: ['read-fact'], resources: ['public-data'], max_cost_micros: 10000, expires_at: '2026-12-01T00:00:00Z', approval_required: false } };
export const governance = definition('governance-check', 'Enterprise policy evaluation', 'Evaluate exact actor, tool, resource, time, approval and budget constraints with default-deny decisions. Returns an auditable policy report; the caller enforces the result.', policySchema, policyExample, policyDecision, i => { iso(i.now); iso(i.policy.expires_at); });
