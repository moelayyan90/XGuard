const EXPECTED_PATH_SECRET_HASH="211cd6e8f1e2cba26142d9afe3e5f4398c532d70db1e6dec2e03e6d9464cc53d";
const enc=new TextEncoder();
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(s){return hex(await crypto.subtle.digest("SHA-256",enc.encode(s)))}
async function hmac(secret,body){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,enc.encode(body)))}
function equal(a,b){if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}

export default {
  async fetch(request) {
    try{
      const url=new URL(request.url);
      if(url.pathname==="/healthz") return json({status:"ok",service:"XGuard Lemon Squeezy webhook",version:"0.1.0"});
      const m=url.pathname.match(/^\/webhooks\/lemonsqueezy\/([A-Za-z0-9_-]{32,128})$/);
      if(!m) return json({error:"not_found"},404);
      if(request.method!=="POST") return json({error:"method_not_allowed"},405);
      const secret=m[1];
      if(await sha256(secret)!==EXPECTED_PATH_SECRET_HASH) return json({error:"not_found"},404);
      const raw=await request.text();
      const supplied=(request.headers.get("x-signature")||"").trim().toLowerCase();
      const expected=await hmac(secret,raw);
      if(!equal(expected,supplied)) return json({error:"invalid_signature"},401);
      let payload;try{payload=JSON.parse(raw)}catch{return json({error:"invalid_json"},400)}
      const event=request.headers.get("x-event-name")||payload?.meta?.event_name||"";
      if(event!=="order_created") return json({accepted:true,ignored:true,event});
      const data=payload?.data||{};
      const a=data.attributes||{};
      console.log(JSON.stringify({event:"lemon_order_created",order_id:String(data.id||""),identifier:String(a.identifier||""),product_id:String(a.first_order_item?.product_id||""),variant_id:String(a.first_order_item?.variant_id||""),total_usd:Number(a.total_usd||0),test_mode:Boolean(a.test_mode)}));
      return json({accepted:true,event:"order_created"});
    }catch(e){console.error(JSON.stringify({event:"lemonhook_error",message:String(e?.message||e)}));return json({error:"internal_error"},500)}
  }
};
