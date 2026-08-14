import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

const templatePath = valueAfter("--template", "apps/worker/wrangler.jsonc");
const outputPath = valueAfter(
  "--output",
  "apps/worker/wrangler.resolved.jsonc",
);
const databaseName = valueAfter("--database-name", "xguard-testnet");
const placeholder = "00000000-0000-0000-0000-000000000000";

const template = readFileSync(templatePath, "utf8");

if (!template.includes(placeholder)) {
  writeFileSync(outputPath, template, "utf8");
  console.log(
    JSON.stringify({
      outputPath,
      databaseName,
      resolved: false,
      reason: "database id already configured",
    }),
  );
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
let raw;
try {
  raw = execFileSync(npx, ["wrangler", "d1", "list", "--json"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const stderr = error?.stderr?.toString?.() ?? "";
  throw new Error(`Unable to list Cloudflare D1 databases. ${stderr}`.trim());
}

let databases;
try {
  databases = JSON.parse(raw);
} catch {
  throw new Error("Wrangler returned invalid JSON for `d1 list --json`.");
}

if (!Array.isArray(databases)) {
  throw new Error("Wrangler D1 list response was not an array.");
}

const database = databases.find((item) => item?.name === databaseName);
if (!database) {
  throw new Error(
    `Cloudflare D1 database '${databaseName}' was not found in the authorized account.`,
  );
}

const databaseId = database.uuid ?? database.id ?? database.database_id;
if (typeof databaseId !== "string" || databaseId.length < 10) {
  throw new Error(
    `Cloudflare D1 database '${databaseName}' did not expose a usable database id.`,
  );
}

const resolved = template.replaceAll(placeholder, databaseId);
writeFileSync(outputPath, resolved, "utf8");

console.log(JSON.stringify({ outputPath, databaseName, resolved: true }));
