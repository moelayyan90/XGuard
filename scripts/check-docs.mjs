import { access, readFile } from "node:fs/promises";
import { load } from "js-yaml";

const requiredFiles = [
  "README.md",
  "QUICKSTART.md",
  "BILLING.md",
  "PRICING.md",
  "DISTRIBUTION.md",
  "docs/API.md",
  "docs/FACILITATORS.md",
  "docs/openapi.yaml",
];

for (const file of requiredFiles) await access(file);

const openapi = await readFile("docs/openapi.yaml", "utf8");
const contract = load(openapi);
if (
  typeof contract !== "object" ||
  contract === null ||
  contract.openapi !== "3.1.0" ||
  typeof contract.paths !== "object" ||
  contract.paths === null
)
  throw new Error("OpenAPI document did not parse into the expected contract");
for (const marker of [
  "openapi: 3.1.0",
  "  /start:",
  "  /v1/activate/challenge:",
  "  /v1/activate:",
  "  /v1/fees:",
  "  /v1/fees/claim:",
  "  /supported:",
  "  /verify:",
  "  /settle:",
  "postpaid-capped-revenue-share",
  "none-after-one-time-wallet-activation",
  "mode: { const: mainnet }",
  'network: { const: "eip155:8453" }',
]) {
  if (!openapi.includes(marker))
    throw new Error(`OpenAPI zero-friction boundary is missing: ${marker}`);
}

const readme = await readFile("README.md", "utf8");
for (const link of [
  "[Quickstart](QUICKSTART.md)",
  "[API](docs/API.md)",
  "[facilitators](docs/FACILITATORS.md)",
]) {
  if (!readme.includes(link))
    throw new Error(`README link is missing: ${link}`);
}
for (const marker of [
  "https://xguardgate.com",
  "https://xguardgate.com/start",
  "One merchant signature",
  "HTTPFacilitatorClient",
  "0.5%",
  "$0.001",
  "separate postpaid service receivable",
  "Legacy universal-gateway compatibility",
]) {
  if (!readme.includes(marker))
    throw new Error(`README zero-friction boundary is missing: ${marker}`);
}

const quickstart = await readFile("QUICKSTART.md", "utf8");
for (const marker of [
  "https://xguardgate.com/start",
  "HTTPFacilitatorClient",
  "No XGuard account",
  "No XGuard-specific package",
  "/v1/fees?payTo=",
]) {
  if (!quickstart.includes(marker))
    throw new Error(`QUICKSTART zero-friction boundary is missing: ${marker}`);
}

const billing = await readFile("BILLING.md", "utf8");
for (const marker of [
  "one-signature",
  "postpaid",
  "0.5%",
  "$0.001",
  "independent Base finality",
  "Legacy universal-gateway billing",
]) {
  if (!billing.includes(marker))
    throw new Error(`BILLING zero-friction boundary is missing: ${marker}`);
}

const pricing = await readFile("PRICING.md", "utf8");
for (const marker of [
  "0.5%",
  "$0.001",
  "fee_bps",
  "fee_cap_micro_usd",
  "separate postpaid service receivable",
]) {
  if (!pricing.includes(marker))
    throw new Error(`PRICING zero-friction boundary is missing: ${marker}`);
}

const facilitators = await readFile("docs/FACILITATORS.md", "utf8");
for (const marker of [
  "xpay",
  "https://facilitator.xpay.sh",
  "0.5%",
  "$0.001",
  "one signed merchant-wallet activation",
  "does not claim ownership of the downstream xpay signer",
]) {
  if (!facilitators.includes(marker))
    throw new Error(`Facilitator zero-friction boundary is missing: ${marker}`);
}

for (const [path, body] of [
  ["README.md", readme],
  ["QUICKSTART.md", quickstart],
  ["BILLING.md", billing],
]) {
  if (
    body.includes("Before the first billable settlement, create a top-up intent") ||
    body.includes("Authorization: Bearer <XGUARD_API_KEY>")
  ) {
    throw new Error(
      `${path} must not present legacy API-key/prepaid onboarding as the primary x402 path`,
    );
  }
}

console.log("Documentation contract check passed.");
