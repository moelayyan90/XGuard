// Read-only provider audit. Output contains aggregate counters and capability
// failures only. Never print credentials, request bodies, settings or raw logs.
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
if (!token || !/^[a-f0-9]{32}$/i.test(account)) throw Error('Provider audit credentials unavailable');
const redact = x => String(x).replaceAll(token, '[redacted]').replaceAll(account, '[account]').slice(0, 250);
async function api(path, body) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok || value.success === false || value.errors?.length) throw Error(JSON.stringify({ status: response.status, errors: (value.errors || []).map(e => redact(e.message)) }));
  return value;
}
async function inspect(label, fn) { try { console.log(JSON.stringify({ audit: label, ...await fn() })); } catch (e) { console.log(JSON.stringify({ audit: label, available: false, reason: redact(e.message) })); } }
await inspect('subscriptions', async () => {
  const { result } = await api(`/accounts/${account}/subscriptions`);
  return { available: true, plans: result.map(p => ({ plan: p.rate_plan?.id || p.plan?.id, name: p.rate_plan?.public_name || p.plan?.name, state: p.state, frequency: p.frequency })) };
});
await inspect('worker_settings', async () => {
  const { result } = await api(`/accounts/${account}/workers/scripts/xguard-mainnet/settings`);
  return { available: true, usage_model: result.usage_model, limits: result.limits, observability: result.observability,
    bindings: result.bindings?.map(b => ({ name: b.name, type: b.type, class_name: b.class_name })) };
});
await inspect('namespaces', async () => {
  const { result } = await api(`/accounts/${account}/workers/durable_objects/namespaces?per_page=100`);
  return { available: true, namespaces: result.map(n => ({ id: n.id, name: n.name, script: n.script, class: n.class, use_sqlite: n.use_sqlite })) };
});
await inspect('daily_durable_usage', async () => {
  // Discover dataset/metric names from the live schema instead of assuming that
  // request counters represent SQLite row reads or writes.
  const schema = await api('/graphql', { query: '{ __schema { types { name fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } }' });
  const types = schema.data?.__schema?.types;
  if (!types) throw Error('Analytics schema unavailable');
  const named = t => t ? t.name || named(t.ofType) : null;
  const accountType = types.find(t => t.fields?.some(f => f.name === 'durableObjectsInvocationsAdaptiveGroups'));
  if (!accountType) throw Error('Durable Objects datasets unavailable to this token');
  const start = new Date().toISOString().slice(0, 10) + 'T00:00:00Z', end = new Date().toISOString();
  const datasets = [];
  for (const f of accountType.fields.filter(f => /^durableObjects.*Groups$/.test(f.name))) {
    const row = types.find(t => t.name === named(f.type));
    const sum = types.find(t => t.name === named(row?.fields?.find(x => x.name === 'sum')?.type));
    const metrics = sum?.fields?.map(x => x.name).filter(n => /requests|rowsRead|rowsWritten|readUnits|writeUnits|sql.*(Read|Writ)/i.test(n)) || [];
    if (!metrics.length) { console.log(JSON.stringify({ audit: 'dataset_schema', dataset: f.name, row: row?.name, sum_fields: sum?.fields?.map(x => x.name) || [] })); continue; }
    const dimension = types.find(t => t.name === named(row?.fields?.find(x => x.name === 'dimensions')?.type));
    const dims = dimension?.fields?.map(x => x.name).filter(n => /namespaceId|scriptName|className/.test(n)) || [];
    datasets.push({ name: f.name, metrics, dims });
  }
  const results = [];
  for (const d of datasets) {
    const query = `{ viewer { accounts(filter: {accountTag: "${account}"}) { ${d.name}(filter: {datetime_geq: "${start}", datetime_leq: "${end}"}, limit: 1000) { sum { ${d.metrics.join(' ')} } ${d.dims.length ? `dimensions { ${d.dims.join(' ')} }` : ''} } } } }`;
    try { const value = await api('/graphql', { query }); results.push({ dataset: d.name, groups: value.data?.viewer?.accounts?.flatMap(a => a[d.name] || []) }); }
    catch (e) { results.push({ dataset: d.name, available: false, reason: redact(e.message) }); }
  }
  return { available: results.some(r => r.groups), utc_start: start, utc_end: end, datasets: datasets.map(d => ({ name: d.name, metrics: d.metrics })), results };
});
