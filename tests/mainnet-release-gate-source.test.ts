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
    expect(deployWorkflow).toContain("src\\/monetized-mainnet\\.ts");
  });

  it("does not dry-run non-production Worker targets from the mainnet gate", () => {
    const script = packageJson.scripts?.["verify:mainnet-release"] ?? "";

    expect(script).toContain("build:mainnet");
    expect(script).not.toContain("run build &&");
    expect(script).not.toContain("build:economic-preview");
  });

  it("keeps discovery compatibility behind the monetized production entrypoint", () => {
    expect(mainnetConfig).toContain('"main": "src/monetized-mainnet.ts"');
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
