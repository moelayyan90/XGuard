import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { declareOfferReceiptExtension } from "@x402/extensions/offer-receipt";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
} from "@x402/extensions/payment-identifier";
import {
  applyMigration,
  rollbackLatest,
  runDoctor,
} from "../packages/cli/src/index.js";
import { fixturePayment } from "./fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  while (directories.length > 0)
    await rm(directories.pop() as string, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xguard-cli-"));
  directories.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "@x402/core": "2.22.0" } }),
  );
  await writeFile(
    join(root, "src", "server.ts"),
    'import { HTTPFacilitatorClient } from "@x402/core/http";\nconst client = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });\n',
  );
  return root;
}

describe("one-command reversible migration", () => {
  it("backs up, applies a minimal URL change, diagnoses, and rolls back", async () => {
    const root = await project();
    const before = await readFile(join(root, "src", "server.ts"), "utf8");
    const manifest = await applyMigration(
      root,
      "https://testnet.xguard.example",
      false,
    );
    expect(manifest.changes).toHaveLength(1);
    expect(await readFile(join(root, "src", "server.ts"), "utf8")).toContain(
      "process.env.XGUARD_URL",
    );
    expect(
      await readFile(join(root, "src", "server.ts"), "utf8"),
    ).not.toContain("https://x402.org/facilitator");
    expect(manifest.changes[0]?.previousUrls).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return url.endsWith("/supported")
          ? new Response(
              JSON.stringify({
                kinds: [
                  {
                    x402Version: 2,
                    scheme: "exact",
                    network: "eip155:84532",
                    extra: {},
                  },
                ],
                extensions: [],
                signers: {},
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }),
    );
    const checks = await runDoctor(root);
    expect(
      checks.find((check) => check.name === "protocol version")?.status,
    ).toBe("PASS");
    await rollbackLatest(root);
    expect(await readFile(join(root, "src", "server.ts"), "utf8")).toBe(before);
    await expect(
      readFile(join(root, "xguard.config.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, ".env.example"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(join(root, ".gitignore"), "utf8")).rejects.toThrow();
  });

  it("refuses rollback after user edits", async () => {
    const root = await project();
    await applyMigration(root, "https://testnet.xguard.example", false);
    await writeFile(join(root, "src", "server.ts"), "user changed this\n");
    await expect(rollbackLatest(root)).rejects.toThrow(/Refusing to overwrite/);
  });

  it("restores pre-existing configuration files exactly", async () => {
    const root = await project();
    await writeFile(join(root, ".env.example"), "EXISTING=true\n");
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    await writeFile(join(root, "xguard.config.json"), '{"existing":true}\n');
    await applyMigration(root, "https://testnet.xguard.example", false);
    await rollbackLatest(root);
    expect(await readFile(join(root, ".env.example"), "utf8")).toBe(
      "EXISTING=true\n",
    );
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "node_modules/\n",
    );
    expect(await readFile(join(root, "xguard.config.json"), "utf8")).toBe(
      '{"existing":true}\n',
    );
  });

  it("does not rewrite unrelated URL properties in the same source file", async () => {
    const root = await project();
    const path = join(root, "src", "server.ts");
    await writeFile(
      path,
      'import { HTTPFacilitatorClient } from "@x402/core/http";\nconst unrelated = { url: "https://merchant.example/api" };\nconst client = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });\n',
    );
    await applyMigration(root, "https://testnet.xguard.example", false);
    const migrated = await readFile(path, "utf8");
    expect(migrated).toContain('url: "https://merchant.example/api"');
    expect(migrated.match(/process\.env\.XGUARD_URL/g)).toHaveLength(1);
  });

  it("edits only the official HTTPFacilitatorClient import binding", async () => {
    const unrelatedRoot = await project();
    const unrelatedPath = join(unrelatedRoot, "src", "server.ts");
    const unrelated =
      'class HTTPFacilitatorClient { constructor(_config: unknown) {} }\nnew HTTPFacilitatorClient({ url: "https://unrelated.example" });\n';
    await writeFile(unrelatedPath, unrelated);
    await expect(
      applyMigration(unrelatedRoot, "https://testnet.xguard.example", false),
    ).rejects.toThrow(/No conservative/);
    expect(await readFile(unrelatedPath, "utf8")).toBe(unrelated);

    const aliasedRoot = await project();
    const aliasedPath = join(aliasedRoot, "src", "server.ts");
    await writeFile(
      aliasedPath,
      'import { HTTPFacilitatorClient as Facilitator } from "@x402/core/http";\nnew Facilitator({ url: "https://provider.example" });\n',
    );
    await applyMigration(aliasedRoot, "https://testnet.xguard.example", false);
    expect(await readFile(aliasedPath, "utf8")).toContain(
      "process.env.XGUARD_URL",
    );
  });

  it("refuses to forward provider authentication during automatic migration", async () => {
    const root = await project();
    const path = join(root, "src", "server.ts");
    const source =
      'import { HTTPFacilitatorClient } from "@x402/core/http";\nconst client = new HTTPFacilitatorClient({ url: "https://provider.example", createAuthHeaders: async () => ({ verify: { Authorization: "Bearer secret" } }) });\n';
    await writeFile(path, source);
    await expect(
      applyMigration(root, "https://testnet.xguard.example", false),
    ).rejects.toThrow(/authentication/);
    expect(await readFile(path, "utf8")).toBe(source);
  });

  it("accepts only HTTPS or credential-free localhost gateway URLs", async () => {
    for (const gateway of [
      "http://xguard.example",
      "https://user:secret@xguard.example",
      "https://xguard.example?token=secret",
      "https://xguard.example/#fragment",
    ]) {
      const root = await project();
      await expect(applyMigration(root, gateway, false)).rejects.toThrow(
        /gateway|credentials|query|fragment/i,
      );
    }
    const root = await project();
    const manifest = await applyMigration(root, "http://localhost:8787", false);
    expect(manifest.gatewayUrl).toBe("http://localhost:8787");
  });

  it("diagnoses payment identifiers, Bazaar, receipts, cache safety, and compatibility", async () => {
    const root = await project();
    const payment = fixturePayment();
    payment.requirements.extra = {
      ...payment.requirements.extra,
      name: "USDC",
      version: "2",
    };
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: payment.payload.resource,
      accepts: [payment.requirements],
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
        ...declareDiscoveryExtension({
          method: "GET",
          output: { example: { ok: true } },
        }),
        ...declareOfferReceiptExtension(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 402,
            headers: {
              "Payment-Required": header,
              "Cache-Control": "private, no-store",
            },
          }),
      ),
    );
    const checks = await runDoctor(root, "https://merchant.example/paid");
    for (const name of [
      "paid endpoint",
      "XGuard compatibility",
      "Payment Identifier",
      "Bazaar metadata",
      "402 cache safety",
    ])
      expect(checks.find((check) => check.name === name)?.status).toBe("PASS");
    expect(
      checks.find((check) => check.name === "duplicate-settlement risk")
        ?.status,
    ).toBe("WARN");
    expect(checks.find((check) => check.name === "Signed Offers")?.status).toBe(
      "WARN",
    );
    expect(
      checks.find((check) => check.name === "Payment Identifier")?.detail,
    ).toMatch(/not exercised/);
    expect(
      checks.find((check) => check.name === "Bazaar metadata")?.detail,
    ).toMatch(/not verified/);
  });

  it("does not diagnose unsupported mainnet or non-authorization options as compatible", async () => {
    const root = await project();
    for (const requirements of [
      fixturePayment({ network: "eip155:8453" }).requirements,
      fixturePayment().requirements,
    ]) {
      requirements.extra = {
        ...requirements.extra,
        name: "USDC",
        version: "2",
        ...(requirements.network === "eip155:84532"
          ? { paymentFlow: "upfront" }
          : {}),
      };
      const payment = fixturePayment({ network: requirements.network });
      const header = encodePaymentRequiredHeader({
        x402Version: 2,
        resource: payment.payload.resource,
        accepts: [requirements],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("", {
              status: 402,
              headers: { "Payment-Required": header },
            }),
        ),
      );
      const checks = await runDoctor(root, "https://merchant.example/paid");
      expect(
        checks.find((check) => check.name === "XGuard compatibility")?.status,
      ).toBe("FAIL");
    }
  });

  it("fails actionable endpoint diagnostics without throwing", async () => {
    const root = await project();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not paid", { status: 200 })),
    );
    const missing = await runDoctor(root, "https://merchant.example/free");
    expect(
      missing.find((check) => check.name === "paid endpoint")?.status,
    ).toBe("FAIL");
    const insecure = await runDoctor(root, "http://merchant.example/paid");
    expect(
      insecure.find((check) => check.name === "paid endpoint")?.detail,
    ).toMatch(/HTTPS/);
  });

  it("distinguishes actual legacy header literals from diagnostic prose and regexes", async () => {
    const root = await project();
    await writeFile(
      join(root, "src", "detector.ts"),
      'const detector = /X-PAYMENT(?:-RESPONSE)?/;\nconst message = "Legacy X-PAYMENT headers";\n',
    );
    let checks = await runDoctor(root);
    expect(
      checks.find((check) => check.name === "protocol version")?.status,
    ).toBe("PASS");

    await writeFile(
      join(root, "src", "legacy.ts"),
      'export const legacy = headers.get("X-PAYMENT");\n',
    );
    checks = await runDoctor(root);
    expect(
      checks.find((check) => check.name === "protocol version")?.status,
    ).toBe("FAIL");
  });

  it("does not mistake a later major dependency for x402 v2", async () => {
    const root = await project();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { "@x402/core": "12.3.0" } }),
    );
    const checks = await runDoctor(root);
    expect(
      checks.find((check) => check.name === "protocol version")?.status,
    ).toBe("FAIL");
  });
});
