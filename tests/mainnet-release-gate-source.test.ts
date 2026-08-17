import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const deployWorkflow = readFileSync(
  ".github/workflows/deploy-mainnet.yml",
  "utf8",
);
const mainnetConfig = readFileSync(
  "apps/worker/wrangler.mainnet.jsonc",
  "utf8",
);
const universalMainnetEntrypoint = readFileSync(
  "apps/worker/src/universal-mainnet.ts",
  "utf8",
);
const monetizedMainnetEntrypoint = readFileSync(
  "apps/worker/src/monetized-mainnet.ts",
  "utf8",
);
const liveMainnetEntrypoint = readFileSync(
  "apps/worker/src/mainnet-modern.ts",
  "utf8",
);

describe("mainnet release gate", () => {
  it("uses the mainnet-specific gate in the production deploy workflow", () => {
    expect(deployWorkflow).toContain("npm run verify:mainnet-release");
    expect(deployWorkflow).not.toContain("npm run verify:release\n");
    expect(deployWorkflow).toContain("src\\/universal-mainnet\\.ts");
    expect(deployWorkflow).toContain(
      "${BASE_URL}/.well-known/xguard/protocols.json",
    );
  });

  it("waits for the new universal registry before probing the rest of the live release", () => {
    const registryProbe = deployWorkflow.indexOf(
      "${BASE_URL}/.well-known/xguard/protocols.json?deploy=${VERIFY_TOKEN}&attempt=${attempt}",
    );
    const healthProbe = deployWorkflow.indexOf(
      "${BASE_URL}/healthz?deploy=${VERIFY_TOKEN}",
    );

    expect(registryProbe).toBeGreaterThan(-1);
    expect(healthProbe).toBeGreaterThan(registryProbe);
    expect(deployWorkflow).toContain(
      "The universal XGuard protocol registry did not propagate.",
    );
  });

  it("does not dry-run non-production Worker targets from the mainnet gate", () => {
    const script = packageJson.scripts?.["verify:mainnet-release"] ?? "";

    expect(script).toContain("build:mainnet");
    expect(script).not.toContain("run build &&");
    expect(script).not.toContain("build:economic-preview");
  });

  it("puts payment discovery and hardening ahead of the monetized production entrypoint", () => {
    expect(mainnetConfig).toContain('"main": "src/universal-mainnet.ts"');
    expect(mainnetConfig).toContain('"workers_dev": false');
    expect(mainnetConfig).toContain('"global_fetch_strictly_public"');
    expect(universalMainnetEntrypoint).toContain(
      'import { genericHttpConnectorResponse } from "./generic-http-connector.js";',
    );
    expect(universalMainnetEntrypoint).toContain(
      'import { universalProtocolResponse } from "./universal-protocol-router.js";',
    );
    expect(universalMainnetEntrypoint).toContain(
      "const paymentContract = publicPaymentContractResponse(",
    );
    expect(universalMainnetEntrypoint).toContain(
      "const securityBlock = universalSecurityGuardResponse(",
    );
    expect(universalMainnetEntrypoint).toContain(
      "const resilientWebhook = await resilientWebhookIngressResponse(",
    );
    expect(universalMainnetEntrypoint).toContain(
      "const protocolResponse = await universalProtocolResponse(",
    );
    expect(universalMainnetEntrypoint).toContain(
      "const genericHttp = await genericHttpConnectorResponse(",
    );
    expect(universalMainnetEntrypoint).toContain(
      "return normalizePublicPaymentContract(standardRequest, response);",
    );
  });

  it("keeps discovery compatibility and billing behind the universal production edge", () => {
    expect(monetizedMainnetEntrypoint).toContain("import mainnetModern, {");
    expect(monetizedMainnetEntrypoint).toContain(
      '["/discovery/search", "discovery.search"]',
    );
    expect(monetizedMainnetEntrypoint).toContain(
      '["/discovery/resources", "discovery.resources"]',
    );
    expect(monetizedMainnetEntrypoint).toContain(
      'authorizeMerchantScope(request, env, "billing")',
    );
    expect(monetizedMainnetEntrypoint).toContain(
      "return delegateFetch(request, env, ctx)",
    );
    expect(liveMainnetEntrypoint).toContain(
      'import { writeEndpointDiscoveryResponse } from "./mainnet-endpoint-discovery.js";',
    );
    expect(liveMainnetEntrypoint).toContain(
      "writeEndpointDiscoveryResponse(standardRequest)",
    );
    expect(liveMainnetEntrypoint).toContain(
      'standardUrl.pathname === "/" && standardRequest.method === "POST"',
    );
    expect(liveMainnetEntrypoint).toContain(
      'headers.set("X-XGuard-Discovery", "root-post")',
    );
  });
});
