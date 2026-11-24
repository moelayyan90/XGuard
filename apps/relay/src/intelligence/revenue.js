import { SERVICES } from './catalog.js';
import { adminIdentity } from '../live/security.ts';
import { livePaidState } from '../paid-agent-entry.js';
const known = new Set(SERVICES.map(d=>d.id));
const key = 'intelligence-cost-evidence:v1';
const isMonth = v=>typeof v==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
function validCost(r) {
  const amount=v=>Number.isSafeInteger(v) && v>=0 && v<=1000000000000;
  return r && known.has(r.service) && isMonth(r.month) && amount(r.amount_usd_micros) && /^[a-zA-Z0-9._/#-]{1,100}$/.test(r.invoice_ref || '') && (r.gross_proceeds_usd_micros===undefined || amount(r.gross_proceeds_usd_micros) && /^[a-zA-Z0-9._/#-]{1,100}$/.test(r.proceeds_ref || ''));
}
export async function costLedger(state,path,body) {
  if (path==='/live/intelligence/costs') return Response.json(await state.storage.get(key) || {});
  if (path==='/live/intelligence/transactions') return Response.json([...((await state.storage.list({prefix:'intel-delivery:',reverse:true,limit:50})).values())]);
  if (path!=='/live/intelligence/set-cost') return null;
  const {month,service,amount_usd_micros,invoice_ref}=body;
  if (!validCost(body)) return Response.json({ error:'invalid_cost_record' },{status:400});
  await state.storage.transaction(async tx=>{
    const records=await tx.get(key)||{};
    (records[month]||={})[service]={amount_usd_micros,invoice_ref,gross_proceeds_usd_micros:body.gross_proceeds_usd_micros??null,proceeds_ref:body.proceeds_ref??null,updated_at:new Date().toISOString()};
    for(const old of Object.keys(records).sort().slice(0,-13))delete records[old];
    await tx.put(key,records);
  });
  return Response.json({saved:true});
}
export async function ownerRevenue(req,env,read) {
  const auth=await adminIdentity(req,env);
  if(!auth)return Response.json({error:'owner_authentication_required'},{status:401});
  if(req.method==='POST') {
    if(auth!=='bearer')return Response.json({error:'owner_bearer_required_for_cost_entry'},{status:403});
    const row=await read(req);
    if(!validCost(row)) return Response.json({error:'invalid_cost_record'},{status:400});
    return Response.json(await livePaidState(env,'/live/intelligence/set-cost',row));
  }
  if(!['GET','HEAD'].includes(req.method))return Response.json({error:'method_not_allowed'},{status:405});
  const [summary,costs,transactions]=await Promise.all(['/live/summary','/live/intelligence/costs','/live/intelligence/transactions'].map(path=>livePaidState(env,path)));
  const currentMonth=new Date().toISOString().slice(0,7), rows=SERVICES.map(d=>{
    const service=summary.commerce?.services?.[d.id],events=summary.metrics?.services?.[d.id]?.events || {};
    const recent=Object.entries(summary.commerce?.days || {}).filter(([date])=>date.startsWith(currentMonth)).map(([,day])=>day.services?.[d.id]?.recognized_revenue_usd_micros || 0);
    const monthCash=recent.reduce((a,b)=>a+b,0);
    const cost=costs[currentMonth]?.[d.id] || null;
    // The ledger records a token quantity. Net USD also needs a documented fiat conversion.
    return { service:d.route,successful_atomic_units:(service?.recognized_revenue_usd_micros || 0)/1000,
      confirmed_usdc_atomic:service?.settled_cash_usd_micros || 0, delivered_usdc_atomic:service?.recognized_revenue_usd_micros || 0,
      delivered_this_month_usdc_atomic:monthCash,cost_this_month_usd_micros:cost?.amount_usd_micros ?? null,invoice_ref:cost?.invoice_ref ?? null,
      net_profit_usd_micros:Number.isSafeInteger(cost?.gross_proceeds_usd_micros) ? cost.gross_proceeds_usd_micros-cost.amount_usd_micros:null, proceeds_ref:cost?.proceeds_ref ?? null,
      measured_gross_margin:cost?.gross_proceeds_usd_micros>0 ? (cost.gross_proceeds_usd_micros-cost.amount_usd_micros)/cost.gross_proceeds_usd_micros:null,
      requests:events.request_received || 0,challenges:events.payment_required || 0,attempts:events.payment_attempt || 0,settlements:events.settlement_success || 0,
      settlement_failures:events.settlement_failed || 0,rejected_payments:events.payment_rejected || 0,deliveries:service?.successful_paid_executions || 0,
      successful_operation_ratio:events.request_received ? (service?.successful_paid_executions || 0)/events.request_received:null };
  }).sort((a,b)=>b.delivered_usdc_atomic-a.delivered_usdc_atomic);
  const money=n=>n===null?'Unmeasured':(n/1000000).toFixed(6);
  if(req.headers.get('accept')?.includes('text/html')) return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard revenue</title><h1>Paid intelligence revenue</h1><p>UTC month '+currentMonth+'</p><table><thead><tr><th>Service</th><th>Settled USDC since activation</th><th>Paid units</th><th>Attempts</th><th>Monthly cost USD</th><th>Monthly profit USD</th></tr></thead><tbody>'+rows.map(r=>'<tr><th>'+r.service+'</th><td>'+money(r.confirmed_usdc_atomic)+'</td><td>'+r.successful_atomic_units+'</td><td>'+r.attempts+'</td><td>'+money(r.cost_this_month_usd_micros)+'</td><td>'+money(r.net_profit_usd_micros)+'</td></tr>').join('')+'</tbody></table></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
  return Response.json({month:currentMonth,services:rows,latest_confirmed_deliveries:transactions,all_product_paying_wallets:summary.all_service_paying_wallets,
    scope:'External, confirmed and delivered x402 purchases of these services since instrumentation. Wallets are counted across all products. Monthly costs are owner-provided invoice allocations. USD profit requires measured conversion, complete costs and fees.'});
}
