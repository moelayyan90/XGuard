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
const commerceMainnetEntrypoint = readFileSync(
  "apps/worker/src/commerce-mainnet.ts",
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
  it("uses the custom-domain mainnet release workflow or an explicit emergency shutdown", () => {
    if (deployWorkflow.includes("intentionally disabled")) {
      expect(deployWorkflow).toContain("workflow_dispatch");
      expect(deployWorkflow).toContain("if: ${{ false }}");
      return;
    }
    expect(deployWorkflow).toContain("npm run verify:mainnet-release");
    expect(deployWorkflow).not.toContain("npm run verify:release\n");
    expect(deployWorkflow).toContain("src\\/universal-mainnet\\.ts");
    expect(deployWorkflow).toContain(
      "${BASE_URL}/.well-known/xguard/protocols.json",
    );
    expect(deployWorkflow).toContain('BASE_URL="https://xguardgate.com"');
  });

  it("does not dry-run non-production Worker targets", () => {
    const script = packageJson.scripts?.["verify:mainnet-release"] ?? "";
    expect(script).toContain("build:mainnet");
    expect(script).not.toContain("run build &&");
    expect(script).not.toContain("build:economic-preview");
  });

  it("locks production to the hardened universal edge", () => {
    const usesUniversalDirectly = mainnetConfig.includes(
      '"main": "src/universal-mainnet.ts"',
    );
    const usesCommerceWrapper = mainnetConfig.includes(
      '"main": "src/commerce-mainnet.ts"',
    );
    expect(usesUniversalDirectly || usesCommerceWrapper).toBe(true);
    if (usesCommerceWrapper) {
      expect(commerceMainnetEntrypoint).toContain(
        'from "./universal-mainnet.js";',
      );
      expect(commerceMainnetEntrypoint).toContain(
        "return base.fetch(request, env, ctx);",
      );
    }
    expect(mainnetConfig).toContain('"workers_dev": false');
    expect(mainnetConfig).toContain('"global_fetch_strictly_public"');
    expect(mainnetConfig).toContain('"WEBHOOK_DELIVERY_QUEUE"');
    expect(mainnetConfig).toContain('"WEBHOOK_RATE_LIMITER"');
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

  it("preserves buyer decision and monetized execution", () => {
    expect(universalMainnetEntrypoint).toContain(
      'import { buyerPortalResponse } from "./buyer-portal.js";',
    );
    expect(universalMainnetEntrypoint).toContain(
      'import { paymentDecisionResponse } from "./payment-decision.js";',
    );
    expect(monetizedMainnetEntrypoint).toContain("import mainnetModern, {");
    expect(monetizedMainnetEntrypoint).toContain(
      'authorizeMerchantScope(request, env, "billing")',
    );
    expect(liveMainnetEntrypoint).toContain(
      'import { writeEndpointDiscoveryResponse } from "./mainnet-endpoint-discovery.js";',
    );
  });
});
