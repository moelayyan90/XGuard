import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const requiredFiles = [
  "README.md",
  "ARCHITECTURE.md",
  "DGRID.md",
  "PROFIT_MODEL.md",
  "PAYOUTS.md",
  "PROVIDERS.md",
  "SECURITY.md",
  "OPERATIONS.md",
  "apps/worker/src/inference-provider.ts",
  "apps/worker/src/inference-provider-router.ts",
  "apps/worker/src/inference-provider-store.ts",
  "apps/worker/migrations/0028_autonomous_inference_provider.sql",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`missing required file: ${file}`);
}

const config = read("apps/worker/wrangler.mainnet.jsonc");
for (const [pattern, label] of [
  [/"name"\s*:\s*"xguard-mainnet"/u, "production worker"],
  [/"main"\s*:\s*"src\/inference-provider\.ts"/u, "inference entrypoint"],
  [/"database_name"\s*:\s*"xguard-mainnet"/u, "production D1"],
  [/"INFERENCE_COORDINATOR"/u, "concurrency coordinator"],
  [/"MIN_MARGIN_USD"/u, "minimum dollar margin"],
  [/"MIN_MARGIN_PERCENT"/u, "minimum percentage margin"],
  [/"MAX_DAILY_LOSS_USD"/u, "daily loss limit"],
  [/"PAYOUT_THRESHOLD_USD"/u, "future payout threshold"],
  [/"MIN_RESERVE_USD"/u, "minimum reserve"],
  [/"OPERATING_RESERVE_PERCENT"/u, "operating reserve"],
  [/"XGUARD_NETWORK_FEE_PERCENT"/u, "verified network fee"],
  [
    /"XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST"/u,
    "variable infrastructure cost",
  ],
  [/"0 \* \* \* \*"/u, "hourly health cron"],
]) {
  if (!pattern.test(config)) throw new Error(`missing ${label}`);
}
if (/XGUARD_PAY_TO|0x[0-9a-f]{40}/iu.test(config))
  throw new Error("production config contains a hard-coded payout destination");
if (/GatewayRequestCoordinator/u.test(config))
  throw new Error(
    "production config contains an unapplied legacy DO migration",
  );
if (
  !/"tag"\s*:\s*"v4"[\s\S]*?"new_sqlite_classes"\s*:\s*\["InferenceCoordinator"\]/u.test(
    config,
  )
)
  throw new Error("production inference DO migration is not v4");

const migration = read(
  "apps/worker/migrations/0028_autonomous_inference_provider.sql",
);
for (const table of [
  "networks",
  "models",
  "upstream_providers",
  "provider_health",
  "network_requests",
  "upstream_requests",
  "routing_metrics",
  "settlements",
  "revenue",
  "costs",
  "payouts",
  "pricing_history",
  "profit_hourly",
  "profit_daily",
  "optimization_runs",
  "alerts",
]) {
  if (
    !new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "u").test(migration)
  )
    throw new Error(`missing D1 table: ${table}`);
}
if (
  !/state TEXT NOT NULL CHECK\(state IN \('QUOTED','PENDING','SETTLED','WITHDRAWABLE','WITHDRAWN','RECEIVED_BY_OWNER'\)\)/u.test(
    migration,
  )
)
  throw new Error("revenue truth-state machine is incomplete");
if (/status,'ACTIVE'.*enabled,1/su.test(migration))
  throw new Error("migration seeds a fake active model");

const source = [
  "apps/worker/src/inference-provider-types.ts",
  "apps/worker/src/inference-provider-store.ts",
  "apps/worker/src/inference-provider-router.ts",
  "apps/worker/src/inference-provider.ts",
]
  .map(read)
  .join("\n");
for (const required of [
  "DGRID_PROVIDER_API_KEY",
  "XGUARD_PAYOUT_DESTINATION",
  "route_blocked_by_profit_guard",
  "daily_loss_limit_reached",
  "NOT_SUPPORTED",
  "scheduledMaintenance",
  "PaymentCoordinator",
  "RequestGate",
  "MainnetPaymentCoordinator",
  "MainnetRequestGate",
  "XPayGlobalRateGate",
  "WebhookDeliveryQueue",
]) {
  if (!source.includes(required))
    throw new Error(`missing runtime gate: ${required}`);
}
if (
  /console\.(log|info|warn|error)|XGUARD_PAYOUT_DESTINATION\s*[:=]\s*["'][^"']+["']/u.test(
    source,
  )
)
  throw new Error("runtime may log or hard-code sensitive payout state");

const docs = [
  "README.md",
  "DGRID.md",
  "PROFIT_MODEL.md",
  "PAYOUTS.md",
  "PROVIDERS.md",
]
  .map(read)
  .join("\n");
for (const required of [
  "https://dgrid.ai/marketplace",
  "https://docs.dgrid.ai/ai-gateway/terms-of-service",
  "provider-channel",
  "PENDING",
  "XGUARD_PAYOUT_DESTINATION",
]) {
  if (!docs.includes(required))
    throw new Error(`documentation missing: ${required}`);
}

console.log("XGuard autonomous inference provider validation passed.");
