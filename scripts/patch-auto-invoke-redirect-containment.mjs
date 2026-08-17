import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "apps/worker/src/auto-invoke.ts";
let source = readFileSync(sourcePath, "utf8");

const marker = `  const latencyMs = Math.max(0, Date.now() - started);\n  if (!isAutoInvokeBillableStatus(upstream.status)) {`;
const replacement = `  const latencyMs = Math.max(0, Date.now() - started);\n  if (isAutoInvokeRedirectStatus(upstream.status)) {\n    const accounting = await releaseAutoInvokeReservation(\n      env.DB,\n      access.merchant.merchantId,\n      reservation.eventKey,\n    );\n    return autoResponse(\n      {\n        error: "upstream_redirect_rejected",\n        provider: route.provider,\n        upstreamStatus: upstream.status,\n      },\n      502,\n      requestId,\n      0,\n      route.provider,\n      latencyMs,\n      accounting,\n    );\n  }\n\n  if (!isAutoInvokeBillableStatus(upstream.status)) {`;
if (source.includes(marker)) source = source.replace(marker, replacement);
else if (!source.includes("upstream_redirect_rejected")) throw new Error("redirect insertion marker not found");

const billable = `export function isAutoInvokeBillableStatus(status: number): boolean {\n  return Number.isInteger(status) && status >= 200 && status < 300;\n}\n`;
const helpers = `${billable}\nexport function isAutoInvokeRedirectStatus(status: number): boolean {\n  return Number.isInteger(status) && status >= 300 && status < 400;\n}\n`;
if (!source.includes("export function isAutoInvokeRedirectStatus")) {
  if (!source.includes(billable)) throw new Error("billable status helper not found");
  source = source.replace(billable, helpers);
}
writeFileSync(sourcePath, source);

const testPath = "tests/auto-invoke.test.ts";
let test = readFileSync(testPath, "utf8");
const oldImport = `  isAutoInvokeBillableStatus,\n  decryptProviderCredential,`;
const newImport = `  isAutoInvokeBillableStatus,\n  isAutoInvokeRedirectStatus,\n  decryptProviderCredential,`;
if (test.includes(oldImport)) test = test.replace(oldImport, newImport);
else if (!test.includes("isAutoInvokeRedirectStatus")) throw new Error("redirect helper import marker not found");

const testMarker = `\n  it("does not intercept unrelated XGuard routes", async () => {`;
const block = `\n  it("classifies provider redirects separately from billable success", () => {\n    for (const status of [300, 301, 302, 303, 307, 308, 399])\n      expect(isAutoInvokeRedirectStatus(status)).toBe(true);\n\n    for (const status of [200, 204, 299, 400, 500])\n      expect(isAutoInvokeRedirectStatus(status)).toBe(false);\n  });\n`;
if (!test.includes("classifies provider redirects separately from billable success")) {
  if (!test.includes(testMarker)) throw new Error("redirect test insertion marker not found");
  test = test.replace(testMarker, block + testMarker);
}
writeFileSync(testPath, test);
