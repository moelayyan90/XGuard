import { createRemoteJWKSet, jwtVerify } from 'jose';
import { adminIdentity } from '../live/security.ts';
import { refreshOwnerReportCheck, ownerReportHealth } from '../live/owner-report-check.ts';

export const monitorAudience = 'https://api.xguardgate.com/internal/release-health';
const issuer = 'https://token.actions.githubusercontent.com';
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), { timeoutDuration: 4500 });
const repo = 'moelayyan90/XGuard';
const workflows = new Set(['deploy.yml','live-monitor.yml'].map(name =>
  repo + '/.github/workflows/' + name + '@refs/heads/main'));

export async function workflowMonitor(token, resolver = keys) {
  if (!token || token.length > 12000 || token.split('.').length !== 3) return false;
  try {
    const {payload} = await jwtVerify(token,resolver,{
      issuer, audience:monitorAudience, algorithms:['RS256'], maxTokenAge:'10 minutes',
      requiredClaims:['iat','exp','sub','repository_id','repository_owner_id','workflow_ref','ref','event_name'],
    });
    return payload.repository_id === '1334264385' && payload.repository_owner_id === '306228198' &&
      payload.repository === repo && payload.ref === 'refs/heads/main' &&
      workflows.has(payload.workflow_ref) && ['workflow_run','workflow_dispatch','schedule','push'].includes(payload.event_name);
  } catch { return false; }
}

export async function releaseHealth(request,env,ctx,legacy) {
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!await adminIdentity(request,env) && !await workflowMonitor(token))
    return Response.json({error:'release_monitor_authentication_required'}, {status:401});
  await refreshOwnerReportCheck(env,(req,value) => legacy(req,value,ctx));
  return ownerReportHealth(env);
}
