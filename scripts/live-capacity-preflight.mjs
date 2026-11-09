import { pathToFileURL } from 'node:url';
export async function capacityPreflight({ fetchImpl = fetch, previousVersion, now = Date.now() } = {}) {
  const response = await fetchImpl('https://xguardgate.com/healthz', { headers: { accept: 'application/json', 'user-agent': 'XGuardLive-capacity-preflight/1.0', 'x-xguard-traffic-class': 'synthetic' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (previousVersion && response.headers.get('x-xguard-worker-version-id') !== previousVersion) throw Error('Production version changed after deployment snapshot');
  const body = await response.json().catch(() => null);
  const quota = response.status === 503 && ['storage_write_quota_exhausted', 'storage_read_quota_exhausted', 'storage_request_quota_exhausted'].includes(body?.error);
  if (quota) {
    if (!Number.isFinite(Date.parse(body.quota_reset_at)) || Date.parse(body.quota_reset_at) <= now) throw Error('Provider quota state needs fresh diagnosis; no canary attempted');
    return { blocked: true, reason: body.error, reset_at: body.quota_reset_at, upload_attempted: false };
  }
  return { blocked: false, baseline_http: response.status, full_canary_checks_required: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await capacityPreflight({ previousVersion: process.env.PREVIOUS_WORKER_ID });
  console.log(JSON.stringify(result));
  if (result.blocked) { console.error('::error title=Provider allowance still exhausted::No Worker upload or canary was attempted. Retry after the documented UTC reset; existing service state and rollback safeguards are preserved.'); process.exitCode = 1; }
}
