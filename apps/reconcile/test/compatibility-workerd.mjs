import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from "miniflare";
import { decodePaymentRequiredHeader } from "@x402/core/http";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.argv[2];
assert.match(base || "", /^[0-9a-f]{40}$/, "Pass the exact baseline commit SHA");
const temporary = await mkdtemp(join(tmpdir(), "xguard-reconcile-baseline-"));
const checkout = join(temporary, "checkout");
const baselineApp = join(checkout, "apps/reconcile");
const bindings = {
  XGUARD_TREASURY_USDC_ADDRESS: "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07",
  X402_FACILITATOR: "https://facilitator.test",
  BASE_RPC_URL: "https://base-rpc.test"
};

async function runtime(scriptPath, name) {
  const logs = [];
  let supportedCalls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, cf: false,
    handleStructuredLogs: log => logs.push(log), workers: [{ name, modules: true, scriptPath, modulesRoot: dirname(scriptPath),
      compatibilityDate: "2026-08-26", compatibilityFlags: ["nodejs_compat"], bindings,
      outboundService: async request => {
        assert.equal(request.url, "https://facilitator.test/supported");
        supportedCalls++;
        return MFResponse.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: ["bazaar"], signers: {} });
      }
    }]
  }));
  await mf.ready;
  return { mf, logs, supportedCalls: () => supportedCalls };
}

async function responseOf(runtime, path, method = "GET") {
  const response = await runtime.mf.dispatchFetch(`https://reconcile.xguardgate.com${path}`, { method, signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  const required = response.headers.get("payment-required");
  return { status: response.status, body, required: required ? decodePaymentRequiredHeader(required) : null,
    headers: Object.fromEntries(["content-type", "cache-control", "link", "x-xguard-monitor-discovery"].map(key => [key, response.headers.get(key)])) };
}

let before, after;
try {
  execFileSync("git", ["worktree", "add", "--detach", checkout, base], { cwd: root, stdio: "pipe" });
  await symlink(join(root, "node_modules"), join(baselineApp, "node_modules"), "dir");
  execFileSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--config", join(baselineApp, "wrangler.jsonc"), "--outdir", join(baselineApp, ".wrangler/bundle")], {
    cwd: baselineApp, stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
  });
  before = await runtime(join(baselineApp, ".wrangler/bundle/discovery-entry.js"), "baseline");
  after = await runtime(join(root, ".wrangler/build/discovery-entry.js"), "fixed");
  // Start with a full-query challenge so baseline initialization is awaited.
  const query = `?from=0x${"1".repeat(40)}&nonce=0x${"2".repeat(64)}`;
  const cases = [
    ["/v1/reconcile" + query], ["/v1/reconcile" + query.replace("from=", "authorizer=")],
    ["/"], ["/", "HEAD"], ["/healthz"], ["/docs"], ["/openapi.json"],
    ["/.well-known/x402"], ["/.well-known/x402.json"], ["/robots.txt"], ["/sitemap.xml"], ["/llms.txt"],
    ["/v1/reconcile"], ["/v1/reconcile?from=invalid"], ["/v1/reconcile?nonce=invalid"]
  ];
  for (const [path, method] of cases) {
    assert.deepEqual(await responseOf(after, path, method), await responseOf(before, path, method), `${method || "GET"} ${path}`);
  }
  assert.equal(after.supportedCalls(), 1);
  assert.doesNotMatch(JSON.stringify(after.logs), /Error compiling schema|Code generation from strings|invalid bazaar extension/);
  console.log(JSON.stringify({ workerd_compatibility: "passed", baseline: base, identical_responses: cases.length,
    baseline_compiler_errors: before.logs.filter(log => log.message.includes("Error compiling schema")).length,
    fixed_compiler_errors: 0, live_provider_calls: 0, production_money_moved: false }));
} finally {
  if (before) await before.mf.dispose();
  if (after) await after.mf.dispose();
  execFileSync("git", ["worktree", "remove", "--force", checkout], { cwd: root, stdio: "pipe" });
  await rm(temporary, { recursive: true, force: true });
}
