import { access, readFile } from "node:fs/promises";
import { load } from "js-yaml";

const requiredFiles = [
  "QUICKSTART.md",
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
  "  /v1/register:",
  "  /v1/topups/intents:",
  "  /supported:",
  "  /verify:",
  "  /settle:",
  "mode: { const: mainnet }",
  'network: { const: "eip155:8453" }',
]) {
  if (!openapi.includes(marker))
    throw new Error(`OpenAPI mainnet boundary is missing: ${marker}`);
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
  "https://xguard-mainnet.maqamapp.workers.dev",
  "$0.002",
  "XGUARD_API_KEY",
  "Merchant top-ups are customer prepayments, not revenue",
]) {
  if (!readme.includes(marker))
    throw new Error(`README mainnet boundary is missing: ${marker}`);
}

console.log("Documentation contract check passed.");
