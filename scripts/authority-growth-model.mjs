import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const evidence = JSON.parse(await readFile(new URL('docs/evidence/financial-authority/runtime-security.json', root), 'utf8'));
const benchmark = evidence.benchmark;
if (!benchmark?.samples) throw Error('Run authority:test with AFA_EVIDENCE_DIR before modeling.');
// Conservative whole-row rounding of a measured, single-leaf local journey.
const reads = BigInt(Math.ceil(benchmark.mean_rows_read)), writes = BigInt(Math.ceil(benchmark.mean_rows_written));
const format = (value, places) => `${value / 10n ** BigInt(places)}.${(value % 10n ** BigInt(places)).toString().padStart(places,'0')}`;
const header = ['stage','operations_in_stage','cumulative_operations','hypothetical_gross_usd_at_0_05','mean_operations_per_second_if_24_hours','measured_model_sql_reads','measured_model_sql_writes','paid_sql_marginal_usd_excluding_allowances','minimum_tenants_at_500_operations_per_day','exceeds_exclusive_100000_daily_write_allowance'];
const rows = [], limits = [];
for (let stage = 1; stage <= 63; stage++) {
  const operations = 1n << BigInt(stage - 1), total = (operations << 1n) - 1n, r = reads * operations, w = writes * operations;
  const exceeds = w > 100000n;
  if (exceeds) limits.push(stage);
  rows.push([stage,operations,total,format(operations*5n,2),format(operations*1000000n/86400n,6),r,w,format(r+w*1000n,9),(operations+499n)/500n,exceeds].join(','));
}
const target = new URL('docs/evidence/financial-authority/growth-63-stages.csv', root);
await mkdir(new URL('./', target), {recursive:true});
await writeFile(target, [header.join(','),...rows].join('\n')+'\n');
const summary = { horizon_assumption: '24 hours per stage, for capacity modeling only; user did not specify stage duration', stages:63,
  stage_63_operations: (1n<<62n).toString(), cumulative_operations: ((1n<<63n)-1n).toString(),
  stage_63_hypothetical_gross_usd: format((1n<<62n)*5n,2), cumulative_hypothetical_gross_usd:format(((1n<<63n)-1n)*5n,2),
  modeled_reads_per_operation:Number(reads),modeled_writes_per_operation:Number(writes),
  sql_only_marginal_usd_per_operation:format(reads+writes*1000n,9),
  first_stage_exceeding_exclusive_free_sql_writes:limits[0],
  market_size_measured:null,independent_paid_operations:0,commercial_revenue_proven:false,
  excluded_costs:['Worker/DO requests','CPU and duration','stored bytes and retention','ProofRail cold starts','real executor settlement and gas','support','tax','payment processing','abuse/recovery workload'],
  caveat:'A projection from a warmed one-leaf mock journey, not measured production unit cost, an invoice, actual revenue, demand, a purchase authorization or an upper bound for every chain. Deeper chains cost more. Shared account traffic reduces the capacity. No unlimited growth forecast is made.',
  pricing_source:'https://developers.cloudflare.com/durable-objects/platform/pricing/' };
await writeFile(new URL('docs/evidence/financial-authority/growth-summary.json',root),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
