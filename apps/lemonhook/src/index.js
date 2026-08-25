const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export default {
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==="/healthz") return json({status:"ok",service:"XGuard billing webhook"});
    return json({error:"not_found"},404);
  }
};
