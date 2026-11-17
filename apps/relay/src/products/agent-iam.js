import { definition, iso } from './common.js';
import { policySchema, policyExample, policyDecision } from './governance.js';

export const agentIam = definition('iam-check', 'Agent permission check', 'Check an explicit least-privilege policy without issuing or accepting third-party credentials. Exact resource matches, expiry, spend caps and approval rules. Provisioning and arbitrary-code sandboxing are unavailable.', policySchema, policyExample, policyDecision, i => { iso(i.now); iso(i.policy.expires_at); });
