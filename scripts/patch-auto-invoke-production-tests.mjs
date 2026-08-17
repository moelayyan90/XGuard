import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/auto-invoke.test.ts";
let test = readFileSync(path, "utf8");

const importOld = `  isAutoInvokeBillableStatus,\n  decryptProviderCredential,`;
const importNew = `  isAutoInvokeBillableStatus,\n  isAutoInvokeRedirectStatus,\n  decryptProviderCredential,`;
if (test.includes(importOld)) test = test.replace(importOld, importNew);
else if (!test.includes("isAutoInvokeRedirectStatus"))
  throw new Error("auto-invoke helper import marker not found");

// Gemini model inference is only allowed after a syntactically valid XGuard
// standard-client key is present.
const geminiStart = test.indexOf('  it("infers Gemini automatically from the model name"');
if (geminiStart < 0) throw new Error("Gemini inference test not found");
const geminiEnd = test.indexOf("\n  it(", geminiStart + 5);
const beforeGemini = test.slice(0, geminiStart);
let geminiBlock = test.slice(geminiStart, geminiEnd < 0 ? test.length : geminiEnd);
if (!geminiBlock.includes('"X-Api-Key"')) {
  const headersOld = `        headers: {\n          "Content-Type": "application/json",\n          "Content-Length": String(new TextEncoder().encode(body).byteLength),\n        },`;
  const headersNew = `        headers: {\n          "Content-Type": "application/json",\n          "Content-Length": String(new TextEncoder().encode(body).byteLength),\n          "X-Api-Key": \`xg_live_\${"a".repeat(48)}\`,\n        },`;
  if (!geminiBlock.includes(headersOld)) throw new Error("Gemini headers block not found");
  geminiBlock = geminiBlock.replace(headersOld, headersNew);
}
test = beforeGemini + geminiBlock + (geminiEnd < 0 ? "" : test.slice(geminiEnd));

const insertion = `\n  it("recognizes Anthropic native SDK traffic without an XGuard-specific route", async () => {`;
const securityTests = `\n  it("does not use an unauthenticated request body for Gemini inference", async () => {\n    const body = JSON.stringify({\n      model: "gemini-3.6-flash",\n      messages: [{ role: "user", content: "hello" }],\n    });\n    const route = await classifyAutoInvokeRoute(\n      new Request(\`${'${ORIGIN}'}/v1/chat/completions\`, {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          "Content-Length": String(new TextEncoder().encode(body).byteLength),\n        },\n        body,\n      }),\n    );\n    expect(route).toMatchObject({\n      provider: "openai",\n      upstreamUrl: "https://api.openai.com/v1/chat/completions",\n    });\n  });\n\n  it("bounds model inference when Content-Length is absent", async () => {\n    const body = JSON.stringify({\n      model: "gemini-3.6-flash",\n      padding: "x".repeat(70 * 1024),\n    });\n    const request = new Request(\`${'${ORIGIN}'}/v1/chat/completions\`, {\n      method: "POST",\n      headers: {\n        "Content-Type": "application/json",\n        "X-Api-Key": \`xg_live_\${"a".repeat(48)}\`,\n      },\n      body,\n    });\n    expect(request.headers.get("content-length")).toBeNull();\n    const route = await classifyAutoInvokeRoute(request);\n    expect(route?.provider).toBe("openai");\n  });\n`;
if (!test.includes("does not use an unauthenticated request body for Gemini inference")) {
  if (!test.includes(insertion)) throw new Error("security test insertion marker not found");
  test = test.replace(insertion, securityTests + insertion);
}

const statusInsertion = `\n  it("rewraps provider credentials when the XGuard merchant key rotates", async () => {`;
const redirectTest = `\n  it("classifies provider redirects separately from billable success", () => {\n    for (const status of [300, 301, 302, 303, 307, 308, 399])\n      expect(isAutoInvokeRedirectStatus(status)).toBe(true);\n\n    for (const status of [200, 204, 299, 400, 500])\n      expect(isAutoInvokeRedirectStatus(status)).toBe(false);\n  });\n`;
if (!test.includes("classifies provider redirects separately from billable success")) {
  if (!test.includes(statusInsertion)) throw new Error("redirect test insertion marker not found");
  test = test.replace(statusInsertion, redirectTest + statusInsertion);
}

writeFileSync(path, test);
