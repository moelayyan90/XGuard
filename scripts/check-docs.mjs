import { access, readFile } from "node:fs/promises";
import { load } from "js-yaml";

const requiredFiles = [
  "QUICKSTART.md",
  "docs/API.md",
  "docs/FACILITATORS.md",
  "docs/openapi.yaml",
  "docs/CHILD_SAFETY.md",
  "docs/child-safety-openapi.yaml",
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
  "  /.well-known/payment-manifest:",
  "  /v1/register:",
  "  /v1/topups/intents:",
  "  /supported:",
  "  /verify:",
  "  /settle:",
  "mode: { const: production }",
  'network: { const: "eip155:8453" }',
  'amountUsd: { const: "0.03" }',
  "amountMicroUsd: { const: 30000 }",
  "event: { const: accepted_authenticated_economic_attempt }",
]) {
  if (!openapi.includes(marker))
    throw new Error(`OpenAPI mainnet boundary is missing: ${marker}`);
}

const safetyOpenapi = await readFile("docs/child-safety-openapi.yaml", "utf8");
const safetyContract = load(safetyOpenapi);
if (
  typeof safetyContract !== "object" ||
  safetyContract === null ||
  safetyContract.openapi !== "3.1.0" ||
  typeof safetyContract.paths !== "object" ||
  safetyContract.paths === null
)
  throw new Error("Child Safety OpenAPI document did not parse correctly");
for (const marker of [
  "title: XGuard Child Safety API",
  "  /v1/child-safety/catalog:",
  "  /v1/child-safety/reporting:",
  "  /v1/child-safety/scan:",
  "FREEZE_CHAT",
  "rawContentStored: { const: false }",
]) {
  if (!safetyOpenapi.includes(marker))
    throw new Error(`Child Safety OpenAPI boundary is missing: ${marker}`);
}

const readme = await readFile("README.md", "utf8");
for (const link of [
  "[Quickstart](QUICKSTART.md)",
  "[API](docs/API.md)",
  "[facilitators](docs/FACILITATORS.md)",
  "[Child Safety](docs/CHILD_SAFETY.md)",
]) {
  if (!readme.includes(link))
    throw new Error(`README link is missing: ${link}`);
}
for (const marker of [
  "# XGuard Child Safety Control Layer",
  "/v1/child-safety/scan",
  "FREEZE_CHAT",
  "per analyzed safety event",
  "## Existing payment/protocol infrastructure",
  "x402 adapter",
]) {
  if (!readme.includes(marker))
    throw new Error(`README child-safety boundary is missing: ${marker}`);
}

console.log("Documentation contract check passed.");
