import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { shardOf, shardName } from "../../relay/src/live/util.ts";

// Use the relay's workerd version to preserve its production compatibility date.
const { Miniflare, Response: MFResponse, convertV4MiniflareOptions } =
  createRequire(new URL("../../relay/package.json", import.meta.url))("miniflare");
const originBundle = resolve(process.env.LIVE_WORKER_BUNDLE ??
  fileURLToPath(new URL("../../../.live-build/live-entry.js", import.meta.url)));
const stageBundle = fileURLToPath(new URL("../dist-stage/staging.js", import.meta.url));
const probeKey = "8c".repeat(32);
let outboundStage = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
  { name: "stage", modules: true, modulesRoot: dirname(stageBundle), scriptPath: stageBundle,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
    durableObjects: { XGUARD_STATE: { className: "XGuardState", useSQLite: true } },
    serviceBindings: { XGUARD_ORIGIN: "xguard-mainnet" },
    bindings: { GATEWAY_ENABLED: "true", PUBLIC_ORIGIN: "https://gateway-stage.invalid",
      MERCHANT_ID: "xguard-stage", PAY_TO: "0x" + "22".repeat(20),
      BASE_RPC_URL: "https://unavailable.invalid", STAGING_PROBE_KEY: probeKey,
      WEB2_TOKEN_SECRET: Buffer.alloc(32, 19).toString("base64url") },
    outboundService: async () => { outboundStage++; throw new Error("Staging attempted outbound payment"); },
  },
  { name: "xguard-mainnet", modules: true, modulesRoot: dirname(originBundle), scriptPath: originBundle,
    compatibilityDate: "2026-08-25", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { LIVE_SHARDS: { className: "LiveShard", useSQLite: true },
      LIVE_CONTROL: { className: "LiveControl", useSQLite: true } },
    bindings: { LIVE_BOOTSTRAP: "off", LIVE_SOURCE_FETCHES: "on", MONETIZATION_MODE: "observe" },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (["cloudflare-dns.com", "one.one.one.one", "dns.google"].includes(url.hostname)) {
        return MFResponse.json({ Status: 0, Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
      }
      if (url.hostname === "registry.npmjs.org" && url.pathname === "/robots.txt") return new MFResponse("", { status: 404 });
      if (url.hostname === "registry.npmjs.org" && url.pathname === "/react/latest") return MFResponse.json({
        name: "react", version: "1.0.0", license: "MIT", engines: { node: ">=18" },
      });
      throw new Error("Unexpected destination in collector fixture");
    },
  },
] }));
try {
  await mf.ready;
  const origin = "https://stage.test";
  const path = "/__xguard_staging_probe";
  for (const [pathname, key] of [[path, undefined], [path, "ff".repeat(32)], ["/fact/npm/react/latest-version", probeKey]]) {
    const response = await mf.dispatchFetch(origin + pathname, { method: "POST", headers: key ? { "x-xguard-stage-key": key } : {} });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
  }
  const ns = await mf.getDurableObjectNamespace("LIVE_SHARDS", "xguard-mainnet");
  const stub = ns.get(ns.idFromName(shardName(shardOf("npm/react"))));
  const rpc = async (op, value) => (await stub.fetch("https://internal/rpc", {
    method: "POST", body: JSON.stringify({ op, ...value }),
  })).json();
  assert.equal((await rpc("seed", { sources: [{ adapter: "npm", identifier: "react" }] })).queued, 1);
  let published;
  for (let i = 0; i < 80; i++) {
    published = await rpc("fact", { id: "npm/react/latest-version" });
    if (published?.current_value === "1.0.0") break;
    await sleep(250);
  }
  assert.equal(published?.current_value, "1.0.0");
  const r = await mf.dispatchFetch(origin + path, { method: "POST", headers: { "x-xguard-stage-key": probeKey } });
  const result = await r.json();
  assert.equal(r.status, 200, JSON.stringify(result));
  assert.deepEqual(result, { ok: true, origin_fact: true, unpaid: 402, invalid: 402,
    synthetic_credit_read: 200, replay: 200, exhausted: 402, real_transfers: 0 });
  assert.equal(outboundStage, 0);
  console.log("Staging integration: real XGuard Live Worker, Service Binding, atomic credits, replay and no outbound payment verified.");
} finally { await mf.dispose(); }
