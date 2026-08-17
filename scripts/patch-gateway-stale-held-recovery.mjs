import { readFileSync, writeFileSync } from "node:fs";

const billingPath = "apps/worker/src/universal-gateway-billing.ts";
let billing = readFileSync(billingPath, "utf8");
const insertion = `\nasync function reholdGatewayFee(`;
const recovery = `\nexport interface GatewayHeldRecoveryResult {\n  scanned: number;\n  released: number;\n  failed: number;\n}\n\nexport async function releaseStaleGatewayHolds(\n  db: D1Database,\n  options: {\n    nowMs?: number;\n    staleAfterMs?: number;\n    limit?: number;\n  } = {},\n): Promise<GatewayHeldRecoveryResult> {\n  const nowMs = options.nowMs ?? Date.now();\n  const staleAfterMs = options.staleAfterMs ?? 60 * 60 * 1000;\n  const limit = options.limit ?? 50;\n  if (!Number.isSafeInteger(nowMs) || nowMs < 0)\n    throw new Error("invalid_gateway_recovery_now");\n  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0)\n    throw new Error("invalid_gateway_recovery_age");\n  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 200)\n    throw new Error("invalid_gateway_recovery_limit");\n\n  const cutoff = new Date(nowMs - staleAfterMs).toISOString();\n  const result = await db\n    .prepare(\n      \`SELECT r.event_key,r.merchant_id\n       FROM gateway_fee_reservations r\n       WHERE r.state='HELD' AND r.updated_at<=?\n         AND NOT EXISTS(\n           SELECT 1 FROM gateway_usage_events u WHERE u.event_key=r.event_key\n         )\n       ORDER BY r.updated_at ASC\n       LIMIT ?\`,\n    )\n    .bind(cutoff, limit)\n    .all<{ event_key: string; merchant_id: string }>();\n\n  let released = 0;\n  let failed = 0;\n  for (const row of result.results ?? []) {\n    try {\n      const final = await releaseGatewayFee(db, row.merchant_id, row.event_key);\n      if (final.state === "RELEASED") released += 1;\n      else failed += 1;\n    } catch {\n      failed += 1;\n    }\n  }\n  return {\n    scanned: result.results?.length ?? 0,\n    released,\n    failed,\n  };\n}\n`;
if (!billing.includes("export async function releaseStaleGatewayHolds")) {
  if (!billing.includes(insertion)) throw new Error("gateway recovery insertion marker not found");
  billing = billing.replace(insertion, recovery + insertion);
}
writeFileSync(billingPath, billing);

const mainPath = "apps/worker/src/mainnet-modern.ts";
let main = readFileSync(mainPath, "utf8");
const importMarker = `import { universalGatewayResponse } from "./universal-gateway.js";`;
const importReplacement = `${importMarker}\nimport { releaseStaleGatewayHolds } from "./universal-gateway-billing.js";`;
if (!main.includes("releaseStaleGatewayHolds")) {
  if (!main.includes(importMarker)) throw new Error("mainnet recovery import marker not found");
  main = main.replace(importMarker, importReplacement);
}
const constantMarker = `const HSTS_VALUE = "max-age=31536000; includeSubDomains";`;
const constantReplacement = `${constantMarker}\nconst GATEWAY_STALE_HOLD_MS = 60 * 60 * 1000;\nconst GATEWAY_STALE_HOLD_LIMIT = 50;`;
if (!main.includes("GATEWAY_STALE_HOLD_MS")) {
  if (!main.includes(constantMarker)) throw new Error("mainnet recovery constant marker not found");
  main = main.replace(constantMarker, constantReplacement);
}
const scheduledOld = `  async scheduled(controller, env, ctx): Promise<void> {\n    await delegateScheduled(controller, env, ctx);\n  },`;
const scheduledNew = `  async scheduled(controller, env, ctx): Promise<void> {\n    await delegateScheduled(controller, env, ctx);\n    const recovery = await releaseStaleGatewayHolds(env.DB, {\n      nowMs:\n        typeof controller.scheduledTime === "number"\n          ? controller.scheduledTime\n          : Date.now(),\n      staleAfterMs: GATEWAY_STALE_HOLD_MS,\n      limit: GATEWAY_STALE_HOLD_LIMIT,\n    });\n    if (recovery.scanned > 0)\n      console.log(\n        JSON.stringify({\n          event: "gateway_stale_hold_recovery",\n          ...recovery,\n        }),\n      );\n  },`;
if (main.includes(scheduledOld)) main = main.replace(scheduledOld, scheduledNew);
else if (!main.includes("gateway_stale_hold_recovery")) throw new Error("mainnet scheduled block not found");
writeFileSync(mainPath, main);
