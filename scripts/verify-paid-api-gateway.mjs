// Production-safe: no seller mutations, signing keys, payment submissions or
// external API execution. A 402 is readiness evidence, never payment evidence.
const api = process.env.XGUARD_API_ORIGIN || 'https://api.xguardgate.com';
const headers = { 'x-xguard-traffic-class': 'monitoring', 'user-agent': 'XGuard-Revenue-Monitor/1.0' };
const report = { observed_at: new Date().toISOString(), paid_transaction_proven: false, tests_count_as_revenue: false, checks: {} };
async function fetchSafe(path, extra = {}) { return fetch(`${api}${path}`, { headers: { ...headers, ...extra }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
try {
  const catalogResponse = await fetchSafe('/v1/marketplace/services');
  const catalog = await catalogResponse.json();
  report.checks.catalog = catalogResponse.ok && catalog.services?.some(x => x.service_id === 'feed-digest' && x.availability === 'available');
  const challenge = await fetchSafe('/p/xguard/feed-digest/'); const body = await challenge.json();
  report.checks.exact_price = challenge.status === 402 && challenge.headers.has('payment-required') && challenge.headers.has('x-xguard-quote') && body.accepts?.[0]?.network === 'eip155:8453';
  report.checks.allocation = BigInt(body.extensions?.xguard?.allocation?.platform_fee_atomic || 0) + BigInt(body.extensions?.xguard?.allocation?.seller_proceeds_atomic || 0) === BigInt(body.accepts?.[0]?.amount || -1);
  report.price_atomic = body.accepts?.[0]?.amount || null;
  const privateRoute = await fetchSafe('/internal/revenue-funnel');
  report.checks.private_revenue_view = privateRoute.status === 401;
  if (process.env.XGUARD_OPERATOR_METRICS_KEY) {
    const response = await fetchSafe('/internal/revenue-funnel', { authorization: `Bearer ${process.env.XGUARD_OPERATOR_METRICS_KEY}` });
    if (!response.ok) throw Error('Configured revenue credential was rejected');
    const revenue = await response.json(); report.metrics = revenue.metrics;
    report.traffic_classes = revenue.classes; report.recent_failures = revenue.recent_failures;
    report.private_ledger_observed = true;
  } else { report.private_ledger_observed = false; report.ledger_blocker = 'XGUARD_OPERATOR_METRICS_KEY unavailable to this monitor; revenue is unknown, not assumed zero'; }
  report.ok = Object.values(report.checks).every(x => x === true);
} catch (error) { report.ok = false; report.error = error.message; }
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
