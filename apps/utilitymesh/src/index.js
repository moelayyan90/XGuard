import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme as registerServerEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const VERSION = "1.0.0";
const API = "https://api.xguardgate.com";
const NETWORK = "eip155:8453";
const FACILITATOR = process.env.X402_FACILITATOR || "https://x402.org/facilitator";
const PAY_TO = process.env.XGUARD_PAY_TO || process.env.X402_PAY_TO_ADDRESS || "";
const PAYMENT_READY = /^0x[a-fA-F0-9]{40}$/.test(PAY_TO);

const defs = [
  {path:"/v1/chain/base/block",price:"$0.001",cat:"blockchain",desc:"Current Base mainnet block number from public JSON-RPC.",q:{},req:[]},
  {path:"/v1/chain/base/gas",price:"$0.002",cat:"blockchain",desc:"Current Base mainnet gas price in wei and gwei.",q:{},req:[]},
  {path:"/v1/chain/base/tx",price:"$0.005",cat:"blockchain",desc:"Base transaction details by transaction hash.",q:{hash:"0x…"},req:["hash"]},
  {path:"/v1/chain/base/receipt",price:"$0.005",cat:"blockchain",desc:"Base transaction receipt by transaction hash.",q:{hash:"0x…"},req:["hash"]},
  {path:"/v1/fx",price:"$0.008",cat:"finance",desc:"Latest fiat FX conversion using ECB-derived Frankfurter data.",q:{from:"USD",to:"EUR",amount:"1"},req:["from","to"]},
  {path:"/v1/crypto/rate",price:"$0.005",cat:"finance",desc:"Current crypto or fiat exchange rate from Coinbase public rates.",q:{asset:"BTC",quote:"USD"},req:["asset","quote"]},
  {path:"/v1/domain/dns",price:"$0.008",cat:"data",desc:"DNS lookup through Cloudflare DNS-over-HTTPS.",q:{domain:"example.com",type:"MX"},req:["domain"]},
  {path:"/v1/domain/rdap",price:"$0.015",cat:"data",desc:"Normalized RDAP domain registration summary.",q:{domain:"example.com"},req:["domain"]},
  {path:"/v1/domain/mail",price:"$0.025",cat:"validation",desc:"Mail-domain preflight: MX, SPF, DMARC and registration signals.",q:{domain:"example.com"},req:["domain"]},
  {path:"/v1/iban/validate",price:"$0.010",cat:"validation",desc:"Deterministic IBAN structure and MOD-97 validation.",q:{iban:"GB82WEST12345698765432"},req:["iban"]},
  {path:"/v1/iban/checksum",price:"$0.020",cat:"validation",desc:"Recalculate an IBAN checksum from a structurally valid BBAN.",q:{iban:"GB00WEST12345698765432"},req:["iban"]},
  {path:"/v1/weather",price:"$0.010",cat:"data",desc:"Current weather at latitude/longitude from Open-Meteo.",q:{lat:"31.95",lon:"35.91"},req:["lat","lon"]},
  {path:"/v1/country",price:"$0.005",cat:"data",desc:"Normalized country facts by ISO code.",q:{code:"JO"},req:["code"]},
  {path:"/v1/worldbank",price:"$0.010",cat:"data",desc:"Latest World Bank indicator observations for a country.",q:{country:"JO",indicator:"NY.GDP.MKTP.CD"},req:["country","indicator"]},
  {path:"/v1/vendor/preflight",price:"$0.075",cat:"validation",desc:"Technical vendor preflight combining domain mail/RDAP and optional IBAN validation.",q:{domain:"example.com",iban:"GB82WEST12345698765432"},req:["domain"]}
];

const byPath = Object.fromEntries(defs.map(x=>[x.path,x]));
const schema = d => ({type:"object",properties:Object.fromEntries(Object.keys(d.q).map(k=>[k,{type:"string"}])),required:d.req});
const routes = Object.fromEntries(defs.map(d=>[`GET ${d.path}`,{
  accepts:[{scheme:"exact",price:d.price,network:NETWORK,payTo:PAY_TO}],
  description:d.desc,mimeType:"application/json",
  extensions:declareDiscoveryExtension({input:d.q,inputSchema:schema(d)})
}]));

const app = new Hono();
const facilitator = new HTTPFacilitatorClient({url:FACILITATOR});
const resourceServer = new x402ResourceServer(facilitator);
registerServerEvmScheme(resourceServer);
if(PAYMENT_READY) app.use(paymentMiddleware(routes,resourceServer));
else app.use("/v1/*",async(c,next)=>byPath[c.req.path]?c.json({error:"payments_not_configured"},503):next());

const J=(c,x,s=200)=>c.json(x,s,{"cache-control":"no-store","x-xguard-version":VERSION});
const D=s=>String(s||"").trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/\.$/,"");
const validDomain=d=>/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d);
const validTx=h=>/^0x[a-fA-F0-9]{64}$/.test(String(h||""));
const compact=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const LEN={AL:28,AD:24,AT:20,AZ:28,BH:22,BY:28,BE:16,BA:20,BR:29,BG:22,CR:22,HR:21,CY:28,CZ:24,DK:18,DO:28,TL:23,EG:29,SV:28,EE:20,FO:18,FI:18,FR:27,GE:22,DE:22,GI:23,GR:27,GL:18,GT:28,HU:28,IS:26,IQ:23,IE:22,IL:23,IT:27,JO:30,KZ:20,XK:20,KW:30,LV:21,LB:28,LY:25,LI:21,LT:20,LU:20,MK:19,MT:31,MR:27,MU:30,MD:24,MC:27,MN:20,ME:22,NL:18,NO:15,PK:24,PS:29,PL:28,PT:25,QA:29,RO:24,RU:33,LC:32,SM:27,ST:25,SA:24,RS:22,SC:31,SK:24,SI:19,ES:24,SD:18,SE:24,CH:21,TN:24,TR:26,UA:29,AE:23,GB:22,VA:22,VG:24};
function mod97(iban){const m=iban.slice(4)+iban.slice(0,4);let r=0;for(const ch of m){const p=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;for(const n of p)r=(r*10+Number(n))%97;}return r;}
function ibanInfo(raw){const iban=compact(raw),country=iban.slice(0,2),expected=LEN[country]||null;const structural=/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)&&(!expected||iban.length===expected);const valid=structural&&mod97(iban)===1;return{iban,country,length:iban.length,expected_length:expected,structural_valid:structural,checksum_valid:valid,valid};}
function checksum(raw){const iban=compact(raw),country=iban.slice(0,2),expected=LEN[country]||null;if(!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)||!expected||iban.length!==expected)return null;const base=country+"00"+iban.slice(4),cd=String(98-mod97(base)).padStart(2,"0"),out=country+cd+iban.slice(4);return{...ibanInfo(out),original:iban,changed:out!==iban};}
async function F(url,init={}){const r=await fetch(url,{...init,headers:{accept:"application/json","user-agent":"XGuard-UtilityMesh/1.0 (+https://xguardgate.com)",...(init.headers||{})}}),t=await r.text();let d;try{d=JSON.parse(t)}catch{throw Error(`upstream_non_json_${r.status}`)}if(!r.ok)throw Error(`upstream_${r.status}`);return d;}
async function rpc(method,params=[]){const d=await F("https://mainnet.base.org",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(d.error)throw Error(d.error.message||"rpc_error");return d.result;}
async function dns(domain,type){return F(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`,{headers:{accept:"application/dns-json"}});}
const answers=d=>(d.Answer||[]).map(x=>({name:x.name,type:x.type,ttl:x.TTL,data:x.data}));
async function rdap(domain){const d=await F(`https://rdap.org/domain/${encodeURIComponent(domain)}`),ev=Object.fromEntries((d.events||[]).map(e=>[e.eventAction,e.eventDate]));return{ldh_name:d.ldhName||domain,status:d.status||[],handle:d.handle||null,registered_at:ev.registration||null,expires_at:ev.expiration||null,last_changed_at:ev.last_changed||ev.last_update_of_rdap_database||null,nameservers:(d.nameservers||[]).map(n=>n.ldhName).filter(Boolean)};}
async function mail(domain){const [mx,txt,dm,rd]=await Promise.allSettled([dns(domain,"MX"),dns(domain,"TXT"),dns(`_dmarc.${domain}`,"TXT"),rdap(domain)]),mxA=mx.status==="fulfilled"?answers(mx.value):[],txtA=txt.status==="fulfilled"?answers(txt.value):[],dmA=dm.status==="fulfilled"?answers(dm.value):[],spf=txtA.find(x=>String(x.data).toLowerCase().includes("v=spf1"))?.data||null,dmarc=dmA.find(x=>String(x.data).toLowerCase().includes("v=dmarc1"))?.data||null;return{domain,mx:mxA,has_mx:mxA.length>0,spf,dmarc,rdap:rd.status==="fulfilled"?rd.value:null,signals:{mail_routable:mxA.length>0,spf_present:Boolean(spf),dmarc_present:Boolean(dmarc),rdap_present:rd.status==="fulfilled"}};}
const Q=(c,k)=>{const v=c.req.query(k);if(v===undefined||v===null||v==="")throw Error(`missing_${k}`);return v;};
async function safe(c,fn){try{return J(c,await fn())}catch(e){const m=String(e?.message||e),s=m.startsWith("missing_")||m.startsWith("invalid_")?400:502;return J(c,{error:m},s)}}

app.get("/v1/chain/base/block",c=>safe(c,async()=>{const h=await rpc("eth_blockNumber");return{network:"base",chain_id:8453,block_number:parseInt(h,16),hex:h,source:"Base public RPC"};}));
app.get("/v1/chain/base/gas",c=>safe(c,async()=>{const h=await rpc("eth_gasPrice"),w=BigInt(h);return{network:"base",gas_price_wei:w.toString(),gas_price_gwei:Number(w)/1e9,hex:h};}));
app.get("/v1/chain/base/tx",c=>safe(c,async()=>{const hash=Q(c,"hash");if(!validTx(hash))throw Error("invalid_hash");const transaction=await rpc("eth_getTransactionByHash",[hash]);return{network:"base",hash,found:Boolean(transaction),transaction};}));
app.get("/v1/chain/base/receipt",c=>safe(c,async()=>{const hash=Q(c,"hash");if(!validTx(hash))throw Error("invalid_hash");const receipt=await rpc("eth_getTransactionReceipt",[hash]);return{network:"base",hash,found:Boolean(receipt),receipt};}));
app.get("/v1/fx",c=>safe(c,async()=>{const from=Q(c,"from").toUpperCase(),to=Q(c,"to").toUpperCase(),amount=Number(c.req.query("amount")||1);if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||!Number.isFinite(amount))throw Error("invalid_fx_input");const d=await F(`https://api.frankfurter.app/latest?from=${from}&to=${to}`),rate=d.rates?.[to];if(!rate)throw Error("upstream_rate_missing");return{date:d.date,from,to,rate,amount,converted:amount*rate,source:"Frankfurter / ECB reference rates"};}));
app.get("/v1/crypto/rate",c=>safe(c,async()=>{const asset=Q(c,"asset").toUpperCase(),quote=Q(c,"quote").toUpperCase();if(!/^[A-Z0-9-]{2,12}$/.test(asset)||!/^[A-Z0-9-]{2,12}$/.test(quote))throw Error("invalid_asset");const d=await F(`https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(asset)}`),rate=Number(d?.data?.rates?.[quote]);if(!Number.isFinite(rate))throw Error("upstream_rate_missing");return{asset,quote,rate,source:"Coinbase public exchange rates"};}));
app.get("/v1/domain/dns",c=>safe(c,async()=>{const domain=D(Q(c,"domain")),type=(c.req.query("type")||"A").toUpperCase();if(!validDomain(domain)||!/^(A|AAAA|MX|TXT|NS|CAA|CNAME|SOA)$/.test(type))throw Error("invalid_dns_input");const d=await dns(domain,type);return{domain,type,status:d.Status,answer:answers(d),source:"Cloudflare DNS over HTTPS"};}));
app.get("/v1/domain/rdap",c=>safe(c,async()=>{const domain=D(Q(c,"domain"));if(!validDomain(domain))throw Error("invalid_domain");return{...await rdap(domain),source:"RDAP bootstrap"};}));
app.get("/v1/domain/mail",c=>safe(c,async()=>{const domain=D(Q(c,"domain"));if(!validDomain(domain))throw Error("invalid_domain");return mail(domain);}));
app.get("/v1/iban/validate",c=>safe(c,async()=>ibanInfo(Q(c,"iban"))));
app.get("/v1/iban/checksum",c=>safe(c,async()=>{const out=checksum(Q(c,"iban"));if(!out)throw Error("invalid_iban_structure");return out;}));
app.get("/v1/weather",c=>safe(c,async()=>{const lat=Number(Q(c,"lat")),lon=Number(Q(c,"lon"));if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)throw Error("invalid_coordinates");const d=await F(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=UTC`);return{latitude:d.latitude,longitude:d.longitude,timezone:d.timezone,current:d.current,current_units:d.current_units,source:"Open-Meteo"};}));
app.get("/v1/country",c=>safe(c,async()=>{const code=Q(c,"code").toUpperCase();if(!/^[A-Z]{2,3}$/.test(code))throw Error("invalid_country_code");const d=await F(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(code)}?fields=name,cca2,cca3,capital,region,subregion,population,currencies,languages,timezones,latlng`),x=Array.isArray(d)?d[0]:d;return{name:x.name,cca2:x.cca2,cca3:x.cca3,capital:x.capital,region:x.region,subregion:x.subregion,population:x.population,currencies:x.currencies,languages:x.languages,timezones:x.timezones,latlng:x.latlng,source:"REST Countries"};}));
app.get("/v1/worldbank",c=>safe(c,async()=>{const country=Q(c,"country").toUpperCase(),indicator=Q(c,"indicator");if(!/^[A-Z0-9]{2,3}$/.test(country)||!/^[A-Z0-9._-]{3,40}$/i.test(indicator))throw Error("invalid_worldbank_input");const d=await F(`https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=12`),rows=Array.isArray(d)&&Array.isArray(d[1])?d[1]:[],observations=rows.filter(x=>x.value!==null).slice(0,5).map(x=>({date:x.date,value:x.value,country:x.country?.value,unit:x.unit||null}));return{country,indicator,observations,source:"World Bank API"};}));
app.get("/v1/vendor/preflight",c=>safe(c,async()=>{const domain=D(Q(c,"domain"));if(!validDomain(domain))throw Error("invalid_domain");const raw=c.req.query("iban"),m=await mail(domain),ib=raw?ibanInfo(raw):null;return{scope:"technical_preflight_only",domain:m,iban:ib,summary:{mail_routable:m.signals.mail_routable,spf_present:m.signals.spf_present,dmarc_present:m.signals.dmarc_present,domain_registration_present:m.signals.rdap_present,iban_valid:ib?.valid??null},note:"Technical signals only; not identity, solvency, sanctions, or legitimacy certification."};}));

const catalog=()=>defs.map(d=>({method:"GET",path:d.path,url:`${API}${d.path}`,price:d.price,price_usd:Number(d.price.slice(1)),network:NETWORK,scheme:"exact",category:d.cat,description:d.desc,query_example:d.q}));
function openapi(){const paths={};for(const d of defs){const parameters=Object.keys(d.q).map(k=>({name:k,in:"query",required:d.req.includes(k),schema:{type:"string"},example:d.q[k]}));paths[d.path]={get:{summary:d.desc,tags:[d.cat],parameters,responses:{"200":{description:"Paid response","content":{"application/json":{schema:{type:"object"}}}},"402":{description:"x402 Payment Required"}},"x-payment-info":{protocols:["x402"],network:NETWORK,scheme:"exact",price:d.price}}};}return{openapi:"3.1.0",info:{title:"XGuard UtilityMesh",version:VERSION,description:"Pay-per-call machine utilities for agents. No API keys or accounts."},servers:[{url:API}],paths};}
app.get("/healthz",c=>J(c,{status:"ok",service:"XGuard UtilityMesh",version:VERSION,payment_ready:PAYMENT_READY,network:NETWORK,facilitator:FACILITATOR,paid_endpoints:defs.length}));
app.get("/catalog",c=>J(c,{name:"XGuard UtilityMesh",version:VERSION,payment_ready:PAYMENT_READY,settlement:{protocol:"x402",network:NETWORK,asset:"USDC"},endpoints:catalog()}));
app.get("/openapi.json",c=>J(c,openapi()));
app.get("/.well-known/x402.json",c=>J(c,{x402Version:2,provider:"XGuard UtilityMesh",catalog:`${API}/catalog`,openapi:`${API}/openapi.json`,facilitator:FACILITATOR,network:NETWORK,endpoints:catalog()}));
app.get("/.well-known/mcp.json",c=>J(c,{name:"xguard-utilitymesh",version:VERSION,transport:"streamable-http",endpoint:`${API}/mcp`,description:"Discovery MCP for XGuard paid x402 utility endpoints."}));
app.get("/llms.txt",c=>c.text(`# XGuard UtilityMesh\n\nAgent-native pay-per-call utilities over x402.\nCatalog: ${API}/catalog\nOpenAPI: ${API}/openapi.json\nMCP discovery: ${API}/mcp\nSettlement: USDC on Base (eip155:8453).\nNo account or API key required.\n`));
app.post("/mcp",async c=>{let m={};try{m=await c.req.json()}catch{return J(c,{jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},400)}const id=m.id??null;if(m.method==="initialize")return J(c,{jsonrpc:"2.0",id,result:{protocolVersion:"2026-07-28",capabilities:{tools:{}},serverInfo:{name:"xguard-utilitymesh",version:VERSION}}});if(m.method==="tools/list")return J(c,{jsonrpc:"2.0",id,result:{tools:[{name:"xguard_discover",description:"List pay-per-call x402 utility endpoints and prices.",inputSchema:{type:"object",properties:{category:{type:"string"}}}},{name:"xguard_endpoint_details",description:"Get details for one paid endpoint path.",inputSchema:{type:"object",properties:{path:{type:"string"}},required:["path"]}},{name:"xguard_status",description:"Check payment readiness and service status.",inputSchema:{type:"object",properties:{}}}]}});if(m.method==="tools/call"){const name=m.params?.name,args=m.params?.arguments||{};let result;if(name==="xguard_discover")result={endpoints:args.category?catalog().filter(x=>x.category===args.category):catalog()};else if(name==="xguard_endpoint_details")result=catalog().find(x=>x.path===args.path)||{error:"not_found"};else if(name==="xguard_status")result={status:"ok",payment_ready:PAYMENT_READY,network:NETWORK,paid_endpoints:defs.length};else return J(c,{jsonrpc:"2.0",id,error:{code:-32601,message:"Unknown tool"}});return J(c,{jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(result)}]}});}return J(c,{jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}});});
app.get("/",c=>c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>XGuard UtilityMesh</title><style>body{margin:0;background:#080b10;color:#f4f7fb;font:16px/1.55 system-ui}main{max-width:1000px;margin:auto;padding:72px 24px}h1{font-size:clamp(48px,8vw,86px);letter-spacing:-.06em;line-height:.95}.lead{font-size:20px;color:#aeb7c5}.pill{border:1px solid #314050;border-radius:99px;padding:7px 11px;color:#9de9d0;font:12px monospace}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:44px}.card{border:1px solid #263241;border-radius:15px;padding:18px;background:#0d131b}.card b,.card span{display:block}.card span{color:#91a0b1;font-size:13px}.price,a{color:#9de9d0}</style><main><span class="pill">${PAYMENT_READY?"LIVE · x402 · BASE USDC":"DEPLOYED · PAYMENT RECIPIENT CHECK"}</span><h1>Machine utilities.<br>Pay only when called.</h1><p class="lead">${defs.length} deterministic agent-ready endpoints. No API keys, accounts, subscriptions, or checkout flows.</p><p><a href="/catalog">Catalog</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/llms.txt">llms.txt</a></p><div class="grid">${defs.map(x=>`<div class="card"><b>${x.path}</b><span>${x.desc}</span><span class="price">${x.price} / call</span></div>`).join("")}</div></main>`));
app.notFound(c=>J(c,{error:"not_found",catalog:`${API}/catalog`},404));
export default app;
