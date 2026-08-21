import { readFileSync } from "node:fs";

const migration = readFileSync(
  "apps/worker/migrations/0025_global_commerce.sql",
  "utf8",
);
const moduleSource = readFileSync(
  "apps/worker/src/global-commerce.ts",
  "utf8",
);
const config = readFileSync("apps/worker/wrangler.mainnet.jsonc", "utf8");

for (const table of [
  "commerce_demands",
  "commerce_offers",
  "commerce_opportunities",
  "commerce_outreach",
  "commerce_feeds",
]) {
  if (!migration.includes(table)) {
    throw new Error(`missing commerce table: ${table}`);
  }
}
for (const gate of [
  "buyer_funding_before_purchase_not_confirmed",
  "supplier_stock_not_verified",
  "profit_threshold_not_met",
  "restricted_goods_gate_failed",
]) {
  if (!moduleSource.includes(gate)) {
    throw new Error(`missing commerce gate: ${gate}`);
  }
}
if (!config.includes('"main": "src/commerce-mainnet.ts"')) {
  throw new Error("commerce mainnet entrypoint not configured");
}
if (!config.includes('"XGUARD_COMMERCE_AUTO_OUTREACH": "true"')) {
  throw new Error("commerce outreach not armed");
}
console.log(JSON.stringify({ ok: true, subsystem: "global-commerce-hunter" }));
