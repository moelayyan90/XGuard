import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationRpcUrls, reconciliationRpcHealth } from "./reconcile-payment.js";

test("recovery RPC configuration stays bounded, explicit and on the requested rail", () => {
  assert.deepEqual(reconciliationRpcUrls({}, "eip155:1"), []);
  assert.deepEqual(reconciliationRpcUrls({ BASE_RPC_FALLBACKS: "invalid" }), []);
  assert.deepEqual(reconciliationRpcUrls({ BASE_RPC_FALLBACKS: '["http://unsafe.test","https://user:pass@invalid.test","https://secondary.test","https://third.test","https://fourth.test"]' }), ["https://mainnet.base.org", "https://secondary.test", "https://third.test"]);
  assert.deepEqual(reconciliationRpcUrls({ BASE_RPC_FALLBACKS: '["https://secondary.test"]' }, "eip155:84532"), ["https://sepolia.base.org"]);
});

test("RPC health accepts an explicit healthy fallback, rejects the wrong chain and only reads", async t => {
  const env = { BASE_RPC_URL: "https://primary.test", BASE_RPC_FALLBACKS: '["https://secondary.test"]' };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({url,method:JSON.parse(init.body).method});
    assert.equal(init.redirect, "manual");
    return url.includes("primary") ? new Response("unavailable", {status:503}) : Response.json({jsonrpc:"2.0",id:1,result:"0x2105"});
  });
  assert.equal((await reconciliationRpcHealth(env)).ready, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(x => x.method === "eth_chainId"));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({result:"0x1"}));
  assert.equal((await reconciliationRpcHealth(env)).ready, false);
});
