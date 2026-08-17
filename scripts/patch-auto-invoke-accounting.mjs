import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/worker/src/auto-invoke.ts";
let source = readFileSync(path, "utf8");

const oldNetwork = `  } catch {\n    await releaseGatewayFee(\n      env.DB,\n      access.merchant.merchantId,\n      reservation.eventKey,\n    ).catch(() => undefined);\n    return autoResponse(\n      { error: "upstream_unavailable", provider: route.provider },\n      502,\n      requestId,\n      0,\n      route.provider,\n      0,\n    );\n  }`;
const newNetwork = `  } catch {\n    const accounting = await releaseAutoInvokeReservation(\n      env.DB,\n      access.merchant.merchantId,\n      reservation.eventKey,\n    );\n    return autoResponse(\n      { error: "upstream_unavailable", provider: route.provider },\n      502,\n      requestId,\n      0,\n      route.provider,\n      0,\n      accounting,\n    );\n  }`;
if (source.includes(oldNetwork)) source = source.replace(oldNetwork, newNetwork);
else if (!source.includes(newNetwork)) throw new Error("network release block not found");

const oldFailure = `  if (!isAutoInvokeBillableStatus(upstream.status)) {\n    await releaseGatewayFee(\n      env.DB,\n      access.merchant.merchantId,\n      reservation.eventKey,\n    ).catch(() => undefined);\n    return proxiedResponse(upstream, requestId, 0, route.provider, latencyMs);\n  }`;
const newFailure = `  if (!isAutoInvokeBillableStatus(upstream.status)) {\n    const accounting = await releaseAutoInvokeReservation(\n      env.DB,\n      access.merchant.merchantId,\n      reservation.eventKey,\n    );\n    return proxiedResponse(\n      upstream,\n      requestId,\n      0,\n      route.provider,\n      latencyMs,\n      accounting,\n    );\n  }`;
if (source.includes(oldFailure)) source = source.replace(oldFailure, newFailure);
else if (!source.includes(newFailure)) throw new Error("non-billable release block not found");

const oldEarn = `  await earnGatewayFee(env.DB, {\n    merchantId: access.merchant.merchantId,\n    eventKey: reservation.eventKey,\n    upstreamStatus: upstream.status,\n    latencyMs,\n    requestBytes: contentLength(request.headers),\n    responseBytes: contentLength(upstream.headers),\n  });\n  return proxiedResponse(\n    upstream,\n    requestId,\n    feeMicroUsd,\n    route.provider,\n    latencyMs,\n  );`;
const newEarn = `  const accounting = await finalizeAutoInvokeSuccess(env.DB, {\n    merchantId: access.merchant.merchantId,\n    eventKey: reservation.eventKey,\n    upstreamStatus: upstream.status,\n    latencyMs,\n    requestBytes: contentLength(request.headers),\n    responseBytes: contentLength(upstream.headers),\n  });\n  return proxiedResponse(\n    upstream,\n    requestId,\n    accounting === "earned" ? feeMicroUsd : 0,\n    route.provider,\n    latencyMs,\n    accounting,\n  );`;
if (source.includes(oldEarn)) source = source.replace(oldEarn, newEarn);
else if (!source.includes(newEarn)) throw new Error("earn block not found");

const billableMarker = `export function isAutoInvokeBillableStatus(status: number): boolean {\n  return Number.isInteger(status) && status >= 200 && status < 300;\n}\n`;
const helpers = `${billableMarker}\nexport type AutoInvokeAccountingState =\n  | "earned"\n  | "released"\n  | "pending-release";\n\nexport async function finalizeAutoInvokeSuccess(\n  db: D1Database,\n  input: {\n    merchantId: string;\n    eventKey: string;\n    upstreamStatus: number;\n    latencyMs: number;\n    requestBytes?: number;\n    responseBytes?: number;\n  },\n): Promise<AutoInvokeAccountingState> {\n  try {\n    await earnGatewayFee(db, input);\n    return "earned";\n  } catch {\n    return releaseAutoInvokeReservation(db, input.merchantId, input.eventKey);\n  }\n}\n\nexport async function releaseAutoInvokeReservation(\n  db: D1Database,\n  merchantId: string,\n  eventKey: string,\n): Promise<Exclude<AutoInvokeAccountingState, "earned">> {\n  try {\n    await releaseGatewayFee(db, merchantId, eventKey);\n    return "released";\n  } catch {\n    return "pending-release";\n  }\n}\n`;
if (!source.includes("export async function finalizeAutoInvokeSuccess")) {
  if (!source.includes(billableMarker)) throw new Error("billable helper marker not found");
  source = source.replace(billableMarker, helpers);
}

const oldProxySignature = `function proxiedResponse(\n  upstream: Response,\n  requestId: string,\n  feeMicroUsd: number,\n  provider: ProviderId,\n  latencyMs: number,\n): Response {`;
const newProxySignature = `function proxiedResponse(\n  upstream: Response,\n  requestId: string,\n  feeMicroUsd: number,\n  provider: ProviderId,\n  latencyMs: number,\n  accounting: AutoInvokeAccountingState,\n): Response {`;
if (source.includes(oldProxySignature)) source = source.replace(oldProxySignature, newProxySignature);
else if (!source.includes(newProxySignature)) throw new Error("proxied response signature not found");

const oldProxyHeader = `  headers.set("X-XGuard-Upstream-Latency-Ms", String(latencyMs));\n  headers.set("X-Content-Type-Options", "nosniff");`;
const newProxyHeader = `  headers.set("X-XGuard-Upstream-Latency-Ms", String(latencyMs));\n  headers.set("X-XGuard-Accounting", accounting);\n  headers.set("X-Content-Type-Options", "nosniff");`;
if (source.includes(oldProxyHeader)) source = source.replace(oldProxyHeader, newProxyHeader);
else if (!source.includes(newProxyHeader)) throw new Error("proxied response headers not found");

const oldAutoSignature = `function autoResponse(\n  value: Record<string, unknown>,\n  status: number,\n  requestId: string,\n  feeMicroUsd: number,\n  provider: ProviderId,\n  latencyMs: number,\n): Response {\n  return jsonResponse(value, status, {\n    "X-XGuard-Auto-Invoked": "true",\n    "X-XGuard-Request-Id": requestId,\n    "X-XGuard-Fee-Micro-Usd": String(feeMicroUsd),\n    "X-XGuard-Provider": provider,\n    "X-XGuard-Upstream-Latency-Ms": String(latencyMs),\n  });\n}`;
const newAutoSignature = `function autoResponse(\n  value: Record<string, unknown>,\n  status: number,\n  requestId: string,\n  feeMicroUsd: number,\n  provider: ProviderId,\n  latencyMs: number,\n  accounting?: AutoInvokeAccountingState,\n): Response {\n  const headers: Record<string, string> = {\n    "X-XGuard-Auto-Invoked": "true",\n    "X-XGuard-Request-Id": requestId,\n    "X-XGuard-Fee-Micro-Usd": String(feeMicroUsd),\n    "X-XGuard-Provider": provider,\n    "X-XGuard-Upstream-Latency-Ms": String(latencyMs),\n  };\n  if (accounting !== undefined) headers["X-XGuard-Accounting"] = accounting;\n  return jsonResponse(value, status, headers);\n}`;
if (source.includes(oldAutoSignature)) source = source.replace(oldAutoSignature, newAutoSignature);
else if (!source.includes(newAutoSignature)) throw new Error("auto response signature not found");

writeFileSync(path, source);
