// Read-only provider audit. Never print credentials, account IDs, billing
// amounts, invoice records, raw responses, headers or private traffic counts.
const token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
const account = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
if (!token || !/^[a-f0-9]{32}$/i.test(account)) throw new Error('Provider audit credentials unavailable');
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function api(path, query) {
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/' + path, { method: query ? 'POST' : 'GET', headers, ...(query ? { body: JSON.stringify({ query }) } : {}), redirect: 'error', signal: AbortSignal.timeout(12000) });
    const body = await response.json(); return { status: response.status, body };
  } catch { return { status: 'network-unavailable', body: {} }; }
}
const report = { checked_at: new Date().toISOString(), mutations: 0, subscription_changes: 0, invoice_cost: 'UNKNOWN' };
const [zones, subscriptions] = await Promise.all([api('zones?name=xguardgate.com'), api(`accounts/${account}/subscriptions`)]);
report.zone_lookup_http = zones.status;
report.subscription_lookup_http = subscriptions.status;
report.worker_plans = (Array.isArray(subscriptions.body.result) ? subscriptions.body.result : []).map(x => ({ name: x.rate_plan?.public_name || x.rate_plan?.id || '', state: x.state || 'unknown' })).filter(x => /worker|durable/i.test(x.name));
const zone = Array.isArray(zones.body.result) ? zones.body.result.find(x => x.name === 'xguardgate.com' && x.account?.id === account) : null;
if (/^[a-f0-9]{32}$/i.test(zone?.id || '')) {
  const rules = await api(`zones/${zone.id}/monetization/rules`);
  report.payment_rules_http = rules.status;
  if (rules.status === 200 && rules.body.success && Array.isArray(rules.body.result?.rules)) report.payment_rule_count = rules.body.result.rules.length;
}
report.crawler_program_eligibility = 'Not established by the generic Payment Required rules API; dedicated program and payout eligibility remain separate.';

const gql = query => api('graphql', query);
const fields = async type => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type || '')) return [];
  const r = await gql(`{__type(name:${JSON.stringify(type)}){fields{name type{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}}`);
  return r.body.data?.__type?.fields || [];
};
const namedType = type => type && (type.name || namedType(type.ofType));
const accountFields = await fields('Account');
const dataset = accountFields.find(x => x.name === 'durableObjectsStorageGroups');
report.storage_schema_available = Boolean(dataset);
if (dataset) {
  const group = await fields(namedType(dataset.type)), sum = group.find(x => x.name === 'sum');
  const metrics = sum ? await fields(namedType(sum.type)) : [];
  const sql = metrics.filter(x => /^(sql)?rows(Read|Written)$/i.test(x.name));
  report.sql_counter_fields = sql.map(x => x.name);
  if (sql.length) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const query = `{viewer{accounts(filter:{accountTag:"${account}"}){durableObjectsStorageGroups(filter:{date_gt:"${yesterday}"},limit:1000){sum{${sql.map(x => x.name).join(' ')}}}}}}`;
    const usage = await gql(query), groups = usage.body.data?.viewer?.accounts?.flatMap(x => x.durableObjectsStorageGroups || []);
    report.sql_usage_http = usage.status;
    if (groups && !usage.body.errors?.length) report.sql_budget_pressure = Object.fromEntries(sql.map(metric => {
      const value = groups.reduce((n, x) => n + Number(x.sum?.[metric.name] || 0), 0), limit = /Written/i.test(metric.name) ? 100000 : 5000000;
      return [metric.name, value >= limit ? 'at-or-above-free-daily-limit' : value >= limit * .8 ? 'above-80-percent' : 'below-80-percent'];
    }));
  }
}
// The documented request metric is independent from SQL read/write budgets.
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const requests = await gql(`{viewer{accounts(filter:{accountTag:"${account}"}){durableObjectsInvocationsAdaptiveGroups(filter:{date_gt:"${yesterday}"},limit:1000){sum{requests}}}}}`);
report.request_metric_http = requests.status;
const groups = requests.body.data?.viewer?.accounts?.flatMap(x => x.durableObjectsInvocationsAdaptiveGroups || []);
if (groups && !requests.body.errors?.length) {
  const total = groups.reduce((n, x) => n + Number(x.sum?.requests || 0), 0);
  report.request_budget_pressure = total >= 100000 ? 'at-or-above-free-daily-limit' : total >= 80000 ? 'above-80-percent' : 'below-80-percent';
}
report.scope = 'Provider account-wide usage categories, not a project invoice or revenue proof. No terms accepted, rules deployed or subscriptions modified. Missing fields remain unknown.';
console.log(JSON.stringify(report));
