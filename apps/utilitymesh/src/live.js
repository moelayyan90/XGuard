import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme as registerServerEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const VERSION="1.1.0", API="https://api.xguardgate.com", NETWORK="eip155:8453", FACILITATOR="https://x402.org/facilitator";
const defs=[
 ["/v1/chain/base/block","$0.001","blockchain","Current Base mainnet block number.",{},[]],
 ["/v1/chain/base/gas","$0.002","blockchain","Current Base mainnet gas price.",{},[]],
 ["/v1/chain/base/tx","$0.005","blockchain","Base transaction details by hash.",{hash:"0x…"},["hash"]],
 ["/v1/chain/base/receipt","$0.005","blockchain","Base transaction receipt by hash.",{hash:"0x…"},["hash"]],
 ["/v1/fx","$0.008","finance","Latest fiat FX conversion from ECB-derived data.",{from:"USD",to:"EUR",amount:"1"},["from","to"]],
 ["/v1/crypto/rate","$0.005","finance","Current crypto/fiat exchange rate.",{asset:"BTC",quote:"USD"},["asset","quote"]],
 ["/v1/domain/dns","$0.008","data","DNS lookup via DNS-over-HTTPS.",{domain:"example.com",type:"MX"},["domain"]],
 ["/v1/domain/rdap","$0.015","data","Normalized domain RDAP registration summary.",{domain:"example.com"},["domain"]],
 ["/v1/domain/mail","$0.025","validation","Mail-domain preflight: MX, SPF, DMARC, RDAP.",{domain:"example.com"},["domain"]],
 ["/v1/iban/validate","$0.010","validation","Deterministic IBAN structure and MOD-97 validation.",{iban:"GB82WEST12345698765432"},["iban"]],
 ["/v1/iban/checksum","$0.020","validation","Recalculate an IBAN checksum from a BBAN.",{iban:"GB00WEST12345698765432"},["iban"]],
 ["/v1/weather","$0.010","data","Current weather at coordinates.",{lat:"31.95",lon:"35.91"},["lat","lon"]],
 ["/v1/country","$0.005","data","Normalized country facts by ISO code.",{code:"JO"},["code"]],
 ["/v1/worldbank","$0.010","data","Latest World Bank indicator observations.",{country:"JO",indicator:"NY.GDP.MKTP.CD"},["country","indicator"]],
 ["/v1/vendor/preflight","$0.075","validation","Technical vendor preflight combining domain and optional IBAN signals.",{domain:"example.com",iban:"GB82WEST12345698765432"},["domain"]]
].map(([path,price,category,description,example,required])=>({path,price,category,description,example,required}));
const byPath=Object.fromEntries(defs.map(d=>[d.path,d]));
const catalog=()=>defs.map(d=>({method:"GET",path:d.path,url:API+d.path,price:d.price,price_usd:Number(d.price.slice(1)),network:NETWORK,scheme:"exact",category:d.category,description:d.description,query_example:d.example}));
const isAddr=x=>/^0x[a-fA-F0-9]{40}$/.test(String(x||""));
const domain=x=>String(x||"").trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/\.$/,"");
const goodDomain=x=>/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(x);
const tx=x=>/^0x[a-fA-F0-9]{64}$/.test(String(x||""));
const Q=(c,k)=>{const v=c.req.query(k);if(v==null||v==="")throw new Error(`missing_${k}`);return v};
const J=(c,x,s=200)=>c.json(x,s,{"cache-control":"no-store","x-xguard-version":VERSION});
const compact=x=>String(x||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const LEN={AL:28,AD:24,AT:20,AZ:28,BH:22,BY:28,BE:16,BA:20,BR:29,BG:22,CR:22,HR:21,CY:28,CZ:24,DK:18,DO:28,TL:23,EG:29,SV:28,EE:20,FO:18,FI:18,FR:27,GE:22,DE:22,GI:23,GR:27,GL:18,GT:28,HU:28,IS:26,IQ:23,IE:22,IL:23,IT:27,JO:30,KZ:20,XK:20,KW:30,LV:21,LB:28,LY:25,LI:21,LT:20,LU:20,MK:19,MT:31,MR:27,MU:30,MD:24,MC:27,MN:20,ME:22,NL:18,NO:15,PK:24,PS:29,PL:28,PT:25,QA:29,RO:24,RU:33,LC:32,SM:27,ST:25,SA:24,RS:22,SC:31,SK:24,SI:19,ES:24,SD:18,SE:24,CH:21,TN:24,TR:26,UA:29,AE:23,GB:22,VA:22,VG:24};
function mod97(i){const m=i.slice(4)+i.slice(0,4);let r=0;for(const ch of m){const p=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;for(const n of p)r=(r*10+Number(n))%97}return r}
function iban(raw){const i=compact(raw),cc=i.slice(0,2),expected=LEN[cc]||null,structural=/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(i)&&(!expected||i.length===expected),valid=structural&&mod97(i)===1;return{iban:i,country:cc,length:i.length,expected_length:expected,structural_valid:structural,checksum_valid:valid,valid}}
function ibanc(raw){const i=compact(raw),cc=i.slice(0,2),expected=LEN[cc];if(!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(i)||!expected||i.length!==expected)return null;const base=cc+"00"+i.slice(4),out=cc+String(98-mod97(base)).padStart(2,"0")+i.slice(4);return{...iban(out),original:i,changed:out!==i}}
async function F(url,init={}){const r=await fetch(url,{...init,headers:{accept:"application/json","user-agent":"XGuard-UtilityMesh/1.1 (+https://xguardgate.com)",...(init.headers||{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{throw new Error(`upstream_non_json_${r.status}`)}if(!r.ok)throw new Error(`upstream_${r.status}`);return d}
async function rpc(method,params=[]){const d=await F("https://mainnet.base.org",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(d.error)throw new Error(d.error.message||"rpc_error");return d.result}
async function dns(name,type="A"){return F(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,{headers:{accept:"application/dns-json"}})}
const answers=d=>(d.Answer||[]).map(x=>({name:x.name,type:x.type,ttl:x.TTL,data:x.data}));
async function rdap(d){const x=await F(`https://rdap.org/domain/${encodeURIComponent(d)}`),ev=Object.fromEntries((x.events||[]).map(e=>[e.eventAction,e.eventDate]));return{domain:x.ldhName||d,status:x.status||[],handle:x.handle||null,registered_at:ev.registration||null,expires_at:ev.expiration||null,last_changed_at:ev.last_changed||ev.last_update_of_rdap_database||null,nameservers:(x.nameservers||[]).map(n=>n.ldhName).filter(Boolean)}}
async function mail(d){const [mx,txt,dm,rd]=await Promise.allSettled([dns(d,"MX"),dns(d,"TXT"),dns(`_dmarc.${d}`,"TXT"),rdap(d)]),M=mx.status==="fulfilled"?answers(mx.value):[],T=txt.status==="fulfilled"?answers(txt.value):[],D=dm.status==="fulfilled"?answers(dm.value):[],spf=T.find(x=>String(x.data).toLowerCase().includes("v=spf1"))?.data||null,dmarc=D.find(x=>String(x.data).toLowerCase().includes("v=dmarc1"))?.data||null;return{domain:d,mx:M,has_mx:M.length>0,spf,dmarc,rdap:rd.status==="fulfilled"?rd.value:null,signals:{mail_routable:M.length>0,spf_present:Boolean(spf),dmarc_present:Boolean(dmarc),rdap_present:rd.status==="fulfilled"}}}
async function safe(c,fn){try{return J(c,await fn())}catch(e){const m=String(e?.message||e);return J(c,{error:m},m.startsWith("missing_")||m.startsWith("invalid_")?400:502)}}
function openapi(){const paths={};for(const d of defs){paths[d.path]={get:{summary:d.description,tags:[d.category],parameters:Object.keys(d.example).map(k=>({name:k,in:"query",required:d.required.includes(k),schema:{type:"string"},example:d.example[k]})),responses:{"200":{description:"Paid response"},"402":{description:"x402 Payment Required"}},"x-payment-info":{protocols:["x402"],network:NETWORK,scheme:"exact",price:d.price}}}}return{openapi:"3.1.0",info:{title:"XGuard UtilityMesh",version:VERSION,description:"Pay-per-call machine utilities for agents. No API keys or accounts."},servers:[{url:API}],paths}}

let cache=null, cacheKey=null;
function build(env){
 const payTo=env.XGUARD_TREASURY_USDC_ADDRESS||env.XGUARD_PAY_TO||env.X402_PAY_TO_ADDRESS||"", ready=isAddr(payTo), key=`${payTo}|${env.X402_FACILITATOR||FACILITATOR}`;
 if(cache&&cacheKey===key)return cache;
 const app=new Hono();
 if(ready){
  const routes=Object.fromEntries(defs.map(d=>[`GET ${d.path}`,{accepts:[{scheme:"exact",price:d.price,network:NETWORK,payTo}],description:d.description,mimeType:"application/json",extensions:declareDiscoveryExtension({input:d.example,inputSchema:{type:"object",properties:Object.fromEntries(Object.keys(d.example).map(k=>[k,{type:"string"}])),required:d.required}})}]));
  const server=new x402ResourceServer(new HTTPFacilitatorClient({url:env.X402_FACILITATOR||FACILITATOR}));registerServerEvmScheme(server);app.use(paymentMiddleware(routes,server));
 } else app.use("/v1/*",async(c,next)=>byPath[c.req.path]?J(c,{error:"payments_not_configured"},503):next());

 app.get("/v1/chain/base/block",c=>safe(c,async()=>{const h=await rpc("eth_blockNumber");return{network:"base",chain_id:8453,block_number:parseInt(h,16),hex:h,source:"Base public RPC"}}));
 app.get("/v1/chain/base/gas",c=>safe(c,async()=>{const h=await rpc("eth_gasPrice"),w=BigInt(h);return{network:"base",gas_price_wei:w.toString(),gas_price_gwei:Number(w)/1e9,hex:h}}));
 app.get("/v1/chain/base/tx",c=>safe(c,async()=>{const h=Q(c,"hash");if(!tx(h))throw new Error("invalid_hash");const v=await rpc("eth_getTransactionByHash",[h]);return{network:"base",hash:h,found:Boolean(v),transaction:v}}));
 app.get("/v1/chain/base/receipt",c=>safe(c,async()=>{const h=Q(c,"hash");if(!tx(h))throw new Error("invalid_hash");const v=await rpc("eth_getTransactionReceipt",[h]);return{network:"base",hash:h,found:Boolean(v),receipt:v}}));
 app.get("/v1/fx",c=>safe(c,async()=>{const from=Q(c,"from").toUpperCase(),to=Q(c,"to").toUpperCase(),amount=Number(c.req.query("amount")||1);if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||!Number.isFinite(amount))throw new Error("invalid_fx_input");const d=await F(`https://api.frankfurter.app/latest?from=${from}&to=${to}`),rate=d.rates?.[to];if(!rate)throw new Error("upstream_rate_missing");return{date:d.date,from,to,rate,amount,converted:amount*rate,source:"Frankfurter / ECB reference rates"}}));
 app.get("/v1/crypto/rate",c=>safe(c,async()=>{const asset=Q(c,"asset").toUpperCase(),quote=Q(c,"quote").toUpperCase();if(!/^[A-Z0-9-]{2,12}$/.test(asset)||!/^[A-Z0-9-]{2,12}$/.test(quote))throw new Error("invalid_asset");const d=await F(`https://api.coinbase.com/v2/exchange-rates?currency=${asset}`),rate=Number(d?.data?.rates?.[quote]);if(!Number.isFinite(rate))throw new Error("upstream_rate_missing");return{asset,quote,rate,source:"Coinbase public exchange rates"}}));
 app.get("/v1/domain/dns",c=>safe(c,async()=>{const d=domain(Q(c,"domain")),type=(c.req.query("type")||"A").toUpperCase();if(!goodDomain(d)||!/^(A|AAAA|MX|TXT|NS|CAA|CNAME|SOA)$/.test(type))throw new Error("invalid_dns_input");const x=await dns(d,type);return{domain:d,type,status:x.Status,answer:answers(x),source:"Cloudflare DNS over HTTPS"}}));
 app.get("/v1/domain/rdap",c=>safe(c,async()=>{const d=domain(Q(c,"domain"));if(!goodDomain(d))throw new Error("invalid_domain");return{...await rdap(d),source:"RDAP bootstrap"}}));
 app.get("/v1/domain/mail",c=>safe(c,async()=>{const d=domain(Q(c,"domain"));if(!goodDomain(d))throw new Error("invalid_domain");return mail(d)}));
 app.get("/v1/iban/validate",c=>safe(c,async()=>iban(Q(c,"iban"))));
 app.get("/v1/iban/checksum",c=>safe(c,async()=>{const x=ibanc(Q(c,"iban"));if(!x)throw new Error("invalid_iban_structure");return x}));
 app.get("/v1/weather",c=>safe(c,async()=>{const lat=Number(Q(c,"lat")),lon=Number(Q(c,"lon"));if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)throw new Error("invalid_coordinates");const d=await F(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=UTC`);return{latitude:d.latitude,longitude:d.longitude,timezone:d.timezone,current:d.current,current_units:d.current_units,source:"Open-Meteo"}}));
 app.get("/v1/country",c=>safe(c,async()=>{const code=Q(c,"code").toUpperCase();if(!/^[A-Z]{2,3}$/.test(code))throw new Error("invalid_country_code");const d=await F(`https://restcountries.com/v3.1/alpha/${code}?fields=name,cca2,cca3,capital,region,subregion,population,currencies,languages,timezones,latlng`),x=Array.isArray(d)?d[0]:d;return{name:x.name,cca2:x.cca2,cca3:x.cca3,capital:x.capital,region:x.region,subregion:x.subregion,population:x.population,currencies:x.currencies,languages:x.languages,timezones:x.timezones,latlng:x.latlng,source:"REST Countries"}}));
 app.get("/v1/worldbank",c=>safe(c,async()=>{const country=Q(c,"country").toUpperCase(),indicator=Q(c,"indicator");if(!/^[A-Z0-9]{2,3}$/.test(country)||!/^[A-Z0-9._-]{3,40}$/i.test(indicator))throw new Error("invalid_worldbank_input");const d=await F(`https://api.worldbank.org/v2/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=12`),rows=Array.isArray(d)&&Array.isArray(d[1])?d[1]:[];return{country,indicator,observations:rows.filter(x=>x.value!==null).slice(0,5).map(x=>({date:x.date,value:x.value,country:x.country?.value,unit:x.unit||null})),source:"World Bank API"}}));
 app.get("/v1/vendor/preflight",c=>safe(c,async()=>{const d=domain(Q(c,"domain"));if(!goodDomain(d))throw new Error("invalid_domain");const m=await mail(d),i=c.req.query("iban")?iban(c.req.query("iban")):null;return{scope:"technical_preflight_only",domain:m,iban:i,summary:{mail_routable:m.signals.mail_routable,spf_present:m.signals.spf_present,dmarc_present:m.signals.dmarc_present,domain_registration_present:m.signals.rdap_present,iban_valid:i?.valid??null},note:"Technical signals only; not identity, solvency, sanctions, or legitimacy certification."}}));

 app.get("/healthz",c=>J(c,{status:"ok",service:"XGuard UtilityMesh",version:VERSION,payment_ready:ready,network:NETWORK,paid_endpoints:defs.length}));
 app.get("/catalog",c=>J(c,{name:"XGuard UtilityMesh",version:VERSION,payment_ready:ready,settlement:{protocol:"x402",network:NETWORK,asset:"USDC"},endpoints:catalog()}));
 app.get("/openapi.json",c=>J(c,openapi()));
 app.get("/.well-known/x402.json",c=>J(c,{x402Version:2,provider:"XGuard UtilityMesh",catalog:`${API}/catalog`,openapi:`${API}/openapi.json`,network:NETWORK,endpoints:catalog()}));
 app.get("/llms.txt",c=>c.text(`# XGuard UtilityMesh\n\nAgent-native pay-per-call utilities over x402.\nCatalog: ${API}/catalog\nOpenAPI: ${API}/openapi.json\nSettlement: USDC on Base.\nNo account or API key required.\n`));
 app.get("/",c=>c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>XGuard UtilityMesh</title><style>body{margin:0;background:#080b10;color:#f4f7fb;font:16px/1.55 system-ui}main{max-width:1000px;margin:auto;padding:72px 24px}h1{font-size:clamp(48px,8vw,86px);letter-spacing:-.06em;line-height:.95}.lead{font-size:20px;color:#aeb7c5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:44px}.card{border:1px solid #263241;border-radius:15px;padding:18px;background:#0d131b}.card span{display:block;color:#91a0b1;font-size:13px}.price,a{color:#9de9d0}</style><main><h1>Machine utilities.<br>Pay only when called.</h1><p class="lead">${defs.length} agent-ready endpoints. No API keys, accounts, subscriptions, or checkout flows.</p><p><a href="/catalog">Catalog</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/llms.txt">llms.txt</a></p><div class="grid">${defs.map(x=>`<div class="card"><b>${x.path}</b><span>${x.description}</span><span class="price">${x.price} / call</span></div>`).join("")}</div></main>`));
 app.notFound(c=>J(c,{error:"not_found",catalog:`${API}/catalog`},404));
 cache=app;cacheKey=key;return app;
}
export default {fetch(request,env,ctx){return build(env).fetch(request,env,ctx)}};
