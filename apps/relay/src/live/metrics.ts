import { sourceSpec } from './adapters.ts';
export function businessMetrics(state: any, shards: any[], now = new Date()): any {
  const month = now.toISOString().slice(0, 7);
  const traffic = shards.flatMap(x => x.requests).filter(x => x.day.startsWith(month));
  const sum = (xs: any[], field: string) => xs.reduce((n, x) => n + Number(x[field] || 0), 0);
  const requests = sum(traffic, 'requests'), verified = sum(traffic.filter(x => x.classification === 'verified-ai'), 'requests');
  const reports = state.revenue.filter((x: any) => x.day.startsWith(month));
  const revenue = reports.length ? sum(reports, 'amount_micros') / 1e6 : null;
  const invoice = state.costs.find((x: any) => x.month === month), cost = invoice ? invoice.amount_micros / 1e6 : null;
  const perThousand = (value: number | null, count: number) => value === null || count === 0 ? null : value * 1000 / count;
  const category = (path: string): string => {
    const parts = path.split('/').slice(2); if (path.split('/')[1] !== 'live') parts.pop();
    try { return sourceSpec(parts.shift() as any, parts.join('/')).topic; } catch { return 'unmapped'; }
  };
  const earnings: Record<string, number> = {}, demand: Record<string, number> = {};
  for (const item of state.category_revenue || []) earnings[category(item.path)] = (earnings[category(item.path)] || 0) + item.amount_micros / 1e6;
  for (const shard of shards) for (const item of shard.top_pages) demand[category(item.path)] = (demand[category(item.path)] || 0) + item.requests;
  return {
    month, total_requests: requests, verified_ai_requests: verified,
    claimed_ai_requests: sum(traffic.filter(x => x.classification === 'claimed-ai'), 'requests'),
    paid_retrievals_reported: sum(reports.filter((x: any) => x.program === 'pay-per-crawl'), 'uses'),
    paid_uses_reported: sum(reports.filter((x: any) => x.program === 'pay-per-use'), 'uses'),
    reported_gross_revenue_usd: revenue, invoiced_cost_usd: cost,
    reported_revenue_per_1000_verified_ai_requests_usd: perThousand(revenue, verified),
    invoiced_cost_per_1000_requests_usd: perThousand(cost, requests),
    reported_gross_margin: revenue !== null && cost !== null && revenue > 0 ? (revenue - cost) / revenue : null,
    top_reported_earning_categories: Object.entries(earnings).sort((a, b) => b[1] - a[1]),
    high_traffic_categories_without_reported_earnings: Object.entries(demand).filter(([key]) => !earnings[key]).sort((a, b) => b[1] - a[1]),
    repeat_crawler_rate_by_shard: shards.map(x => x.repeat?.crawlers ? x.repeat.repeat_crawlers / x.repeat.crawlers : null),
    scope: 'Revenue reflects imported provider reports only; report completeness is not independently verified. Cost reflects the recorded monthly invoice only. Category demand is the top verified-AI pages in the last seven days. Repeat rates are within each shard, not a deduplicated global audience. Null means unavailable, never an estimate.',
  };
}
