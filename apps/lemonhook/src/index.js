const EXPECTED_PATH_SECRET_HASH="69c82b71630e802bbfa2b18beafe756e4ff1e51624954c171b1c5a8be4218bfd";
const CREDITS_PER_PURCHASE=5000;
const enc=new TextEncoder();
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha256(s){return hex(await crypto.subtle.digest("SHA-256",enc.encode(s)))}
async function hmac(secret,body){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,enc.encode(body)))}
function equal(a,b){if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function clientKey(request){const auth=(request.headers.get("authorization")||"").trim();if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,"").trim();return (request.headers.get("x-xguard-key")||"").trim()}

export class CreditLedger {
  constructor(ctx){this.ctx=ctx}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==="/provision"&&request.method==="POST"){
      const body=await request.json();
      const credits=Number(body?.credits||0);
      if(!Number.isInteger(credits)||credits<=0)return json({error:"invalid_credits"},400);
      const existing=await this.ctx.storage.get("record");
      if(existing?.provisioned)return json({ok:true,idempotent:true,balance:Number(existing.balance||0)});
      const record={
        provisioned:true,
        balance:credits,
        order_id:String(body?.order_id||""),
        license_id:String(body?.license_id||""),
        product_id:String(body?.product_id||""),
        user_email:String(body?.user_email||""),
        test_mode:Boolean(body?.test_mode),
        created_at:new Date().toISOString()
      };
      await this.ctx.storage.put("record",record);
      return json({ok:true,idempotent:false,balance:credits});
    }
    if(path==="/balance"&&request.method==="GET"){
      const record=await this.ctx.storage.get("record");
      if(!record?.provisioned)return json({error:"unknown_key"},404);
      return json({credits:Number(record.balance||0),provisioned:true,test_mode:Boolean(record.test_mode)});
    }
    if(path==="/consume"&&request.method==="POST"){
      const body=await request.json();
      const units=Number(body?.units||1);
      if(!Number.isInteger(units)||units<=0||units>1000)return json({error:"invalid_units"},400);
      let result;
      await this.ctx.storage.transaction(async txn=>{
        const record=await txn.get("record");
        if(!record?.provisioned){result={status:404,body:{error:"unknown_key"}};return}
        const balance=Number(record.balance||0);
        if(balance<units){result={status:402,body:{error:"insufficient_credits",credits:balance}};return}
        record.balance=balance-units;
        record.updated_at=new Date().toISOString();
        await txn.put("record",record);
        result={status:200,body:{ok:true,consumed:units,credits:record.balance}};
      });
      return json(result.body,result.status);
    }
    return json({error:"not_found"},404);
  }
}

async function ledgerForKey(env,key){return env.CREDITS.getByName(await sha256(key))}

export default {
  async fetch(request,env) {
    try{
      const url=new URL(request.url);
      if(url.pathname==="/healthz") return json({status:"ok",service:"XGuard Lemon Squeezy webhook",version:"0.2.0",credits_per_purchase:CREDITS_PER_PURCHASE});

      if(url.pathname==="/v1/balance"){
        if(request.method!=="GET")return json({error:"method_not_allowed"},405);
        const key=clientKey(request);if(!key)return json({error:"missing_key"},401);
        return (await ledgerForKey(env,key)).fetch("https://ledger/balance",{method:"GET"});
      }
      if(url.pathname==="/v1/consume"){
        if(request.method!=="POST")return json({error:"method_not_allowed"},405);
        const key=clientKey(request);if(!key)return json({error:"missing_key"},401);
        const raw=await request.text();
        return (await ledgerForKey(env,key)).fetch("https://ledger/consume",{method:"POST",headers:{"content-type":"application/json"},body:raw||"{}"});
      }

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
      const data=payload?.data||{};
      const a=data.attributes||{};

      if(event==="order_created"){
        console.log(JSON.stringify({event:"lemon_order_created",order_id:String(data.id||""),identifier:String(a.identifier||""),product_id:String(a.first_order_item?.product_id||""),variant_id:String(a.first_order_item?.variant_id||""),total_usd:Number(a.total_usd||0),test_mode:Boolean(a.test_mode)}));
        return json({accepted:true,event:"order_created"});
      }

      if(event==="license_key_created"){
        const key=String(a.key||"").trim();
        if(!key)return json({error:"missing_license_key"},400);
        const stub=await ledgerForKey(env,key);
        const provision=await stub.fetch("https://ledger/provision",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({credits:CREDITS_PER_PURCHASE,order_id:a.order_id,license_id:data.id,product_id:a.product_id,user_email:a.user_email,test_mode:Boolean(payload?.meta?.test_mode)})});
        const result=await provision.json();
        console.log(JSON.stringify({event:"lemon_license_key_created",license_id:String(data.id||""),order_id:String(a.order_id||""),product_id:String(a.product_id||""),key_hash:(await sha256(key)).slice(0,16),credits:Number(result.balance||0),idempotent:Boolean(result.idempotent)}));
        return json({accepted:true,event:"license_key_created",provisioned:true,credits:Number(result.balance||0)});
      }

      return json({accepted:true,ignored:true,event});
    }catch(e){console.error(JSON.stringify({event:"lemonhook_error",message:String(e?.message||e)}));return json({error:"internal_error"},500)}
  }
};
