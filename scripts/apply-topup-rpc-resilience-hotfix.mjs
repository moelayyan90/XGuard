import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, oldValue, newValue) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(oldValue)) {
    throw new Error(
      `Expected patch anchor not found in ${path}: ${oldValue.slice(0, 120)}`,
    );
  }
  writeFileSync(path, text.replace(oldValue, newValue));
}

const supervisor = "apps/worker/src/mainnet-supervisor.ts";
const revenue = "apps/worker/src/mainnet-revenue-hardening.ts";
const config = "apps/worker/wrangler.mainnet.jsonc";
const sourceTest = "tests/mainnet-revenue-hardening-source.test.ts";

replaceOnce(
  supervisor,
  "const TOPUP_SCAN_RECOVERY_GRACE_SECONDS = 6 * 60 * 60;\n",
  "const TOPUP_SCAN_RECOVERY_GRACE_SECONDS = 6 * 60 * 60;\nconst TOPUP_SCAN_INTERVAL_MINUTES = 5;\n",
);

replaceOnce(
  supervisor,
  "  BASE_RPC_URL: string;\n  XGUARD_TREASURY_USDC_ADDRESS: string;\n",
  "  BASE_RPC_URL: string;\n  BASE_RPC_FALLBACK_URLS?: string;\n  XGUARD_TREASURY_USDC_ADDRESS: string;\n",
);

replaceOnce(
  supervisor,
  `    ctx.waitUntil(
      runAutomaticTopUpMaintenance(env).catch((error) =>
        console.error(
          JSON.stringify({
            event: "automatic_topup_scan_failed",
            code: errorCode(error),
          }),
        ),
      ),
    );
`,
  `    if (shouldRunAutomaticTopUpScan(controller.scheduledTime))
      ctx.waitUntil(
        runAutomaticTopUpMaintenance(env).catch((error) => {
          const code = errorCode(error);
          if (code.startsWith("rpc_transient_all_providers_unavailable")) {
            console.warn(
              JSON.stringify({
                event: "automatic_topup_scan_deferred",
                code,
                retryWindowMinutes: TOPUP_SCAN_INTERVAL_MINUTES,
              }),
            );
            return;
          }
          console.error(
            JSON.stringify({
              event: "automatic_topup_scan_failed",
              code,
            }),
          );
        }),
      );
`,
);

replaceOnce(
  supervisor,
  `       WHERE state='OPEN'
          OR (state='EXPIRED' AND expires_at_epoch>=?)
       LIMIT 1`,
  `       WHERE state IN ('OPEN','EXPIRED')
         AND expires_at_epoch>=?
       LIMIT 1`,
);

replaceOnce(
  supervisor,
  `  if (relevantIntent === null) return;

  const result = await scanAutomaticTopUps(env);
`,
  `  if (relevantIntent === null) {
    await env.DB.prepare(
      "DELETE FROM treasury_scan_state WHERE scanner_id='base-usdc'",
    ).run();
    return;
  }

  const result = await scanAutomaticTopUpsWithFailover(env);
`,
);

replaceOnce(
  supervisor,
  "async function supervisedFacilitatorRequest(\n",
  `function shouldRunAutomaticTopUpScan(scheduledTimeMs: number): boolean {
  const scheduledMinute = Math.floor(scheduledTimeMs / 60_000);
  return scheduledMinute % TOPUP_SCAN_INTERVAL_MINUTES === 0;
}

async function scanAutomaticTopUpsWithFailover(
  env: MainnetSupervisorEnv,
): Promise<{ scannedThroughBlock: number; credited: number }> {
  const candidates = topUpRpcCandidates(env);
  let lastCode = "rpc_unavailable";

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    try {
      const result = await scanAutomaticTopUps(env, candidate);
      if (index > 0)
        console.warn(
          JSON.stringify({
            event: "automatic_topup_rpc_failover_recovered",
            providerIndex: index,
            providerHost: rpcHost(candidate),
          }),
        );
      return result;
    } catch (error) {
      const code = errorCode(error);
      if (!isRetryableTopUpRpcFailure(error, code)) throw error;
      lastCode = code;
      console.warn(
        JSON.stringify({
          event: "automatic_topup_rpc_provider_unavailable",
          code,
          providerIndex: index,
          providerHost: rpcHost(candidate),
        }),
      );
    }
  }

  throw new Error(\`rpc_transient_all_providers_unavailable:\${lastCode}\`);
}

function topUpRpcCandidates(env: MainnetSupervisorEnv): string[] {
  const raw = [
    env.BASE_RPC_URL,
    ...(env.BASE_RPC_FALLBACK_URLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  const unique: string[] = [];
  for (const candidate of raw) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      if (candidate === env.BASE_RPC_URL) throw new Error("invalid_base_rpc_url");
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      if (candidate === env.BASE_RPC_URL) throw new Error("invalid_base_rpc_url");
      continue;
    }
    const normalized = url.toString();
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  if (unique.length === 0) throw new Error("base_rpc_unavailable");
  return unique;
}

function isRetryableTopUpRpcFailure(error: unknown, code: string): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return (
    /^rpc_http_(408|425|429|500|502|503|504)$/.test(code) ||
    code === "rpc_error" ||
    code.toLowerCase().includes("abort") ||
    code.toLowerCase().includes("timeout")
  );
}

function rpcHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

async function supervisedFacilitatorRequest(
`,
);

replaceOnce(
  revenue,
  `export async function scanAutomaticTopUps(env: HardeningEnv): Promise<{
  scannedThroughBlock: number;
  credited: number;
}> {
  assertEvmAddress(env.XGUARD_TREASURY_USDC_ADDRESS, "treasury");
  const rpcUrl = new URL(env.BASE_RPC_URL);
`,
  `export async function scanAutomaticTopUps(
  env: HardeningEnv,
  baseRpcUrl = env.BASE_RPC_URL,
): Promise<{
  scannedThroughBlock: number;
  credited: number;
}> {
  assertEvmAddress(env.XGUARD_TREASURY_USDC_ADDRESS, "treasury");
  const rpcUrl = new URL(baseRpcUrl);
`,
);

replaceOnce(
  config,
  '    "BASE_RPC_URL": "https://base.drpc.org",\n',
  '    "BASE_RPC_URL": "https://base.drpc.org",\n    "BASE_RPC_FALLBACK_URLS": "https://mainnet.base.org,https://public.1rpc.io/base",\n',
);

replaceOnce(
  sourceTest,
  '    expect(source).toContain("scanAutomaticTopUps(env)");\n',
  '    expect(source).toContain("scanAutomaticTopUpsWithFailover(env)");\n',
);

replaceOnce(
  sourceTest,
  `    const skip = source.indexOf("if (relevantIntent === null) return;", gate);
    const scan = source.indexOf(
      "const result = await scanAutomaticTopUps(env);",
      gate,
    );
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(skip).toBeGreaterThan(gate);
    expect(scan).toBeGreaterThan(skip);
    expect(source).toContain("TOPUP_SCAN_RECOVERY_GRACE_SECONDS");
    expect(source).toContain("state='OPEN'");
    expect(source).toContain("state='EXPIRED'");
`,
  `    const reset = source.indexOf(
      "DELETE FROM treasury_scan_state WHERE scanner_id='base-usdc'",
      gate,
    );
    const scan = source.indexOf(
      "const result = await scanAutomaticTopUpsWithFailover(env);",
      gate,
    );
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(gate);
    expect(scan).toBeGreaterThan(reset);
    expect(source).toContain("TOPUP_SCAN_RECOVERY_GRACE_SECONDS");
    expect(source).toContain("state IN ('OPEN','EXPIRED')");
    expect(source).toContain("expires_at_epoch>=?");
`,
);

replaceOnce(
  sourceTest,
  `  it("does not use the Cloudflare-blocked anonymous PublicNode endpoint", async () => {
    const config = await readFile("apps/worker/wrangler.mainnet.jsonc", "utf8");
    expect(config).toContain('"BASE_RPC_URL": "https://base.drpc.org"');
    expect(config).not.toContain("base-rpc.publicnode.com");
  });
`,
  `  it("uses bounded RPC fallback without the Cloudflare-blocked PublicNode endpoint", async () => {
    const config = await readFile("apps/worker/wrangler.mainnet.jsonc", "utf8");
    expect(config).toContain('"BASE_RPC_URL": "https://base.drpc.org"');
    expect(config).toContain("https://mainnet.base.org");
    expect(config).toContain("https://public.1rpc.io/base");
    expect(config).not.toContain("base-rpc.publicnode.com");
  });
`,
);

writeFileSync(
  "tests/mainnet-topup-rpc-resilience-source.test.ts",
  `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supervisor = readFileSync("apps/worker/src/mainnet-supervisor.ts", "utf8");
const hardening = readFileSync("apps/worker/src/mainnet-revenue-hardening.ts", "utf8");
const mainnetConfig = readFileSync("apps/worker/wrangler.mainnet.jsonc", "utf8");

describe("automatic top-up RPC resilience", () => {
  it("uses demand-bounded polling and multiple RPC candidates", () => {
    expect(supervisor).toContain("TOPUP_SCAN_INTERVAL_MINUTES = 5");
    expect(supervisor).toContain("state IN ('OPEN','EXPIRED')");
    expect(supervisor).toContain("DELETE FROM treasury_scan_state");
    expect(supervisor).toContain("scanAutomaticTopUpsWithFailover");
    expect(supervisor).toContain("automatic_topup_scan_deferred");
    expect(supervisor).toContain("automatic_topup_rpc_failover_recovered");
    expect(mainnetConfig).toContain("BASE_RPC_FALLBACK_URLS");
    expect(mainnetConfig).toContain("https://mainnet.base.org");
    expect(mainnetConfig).toContain("https://public.1rpc.io/base");
    expect(mainnetConfig).not.toContain("base-rpc.publicnode.com");
  });

  it("allows the scanner to receive a per-attempt RPC override", () => {
    expect(hardening).toContain("baseRpcUrl = env.BASE_RPC_URL");
    expect(hardening).toContain("const rpcUrl = new URL(baseRpcUrl)");
  });
});
`,
);
