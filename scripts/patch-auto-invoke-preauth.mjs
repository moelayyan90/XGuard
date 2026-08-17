import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "apps/worker/src/auto-invoke.ts";
let source = readFileSync(sourcePath, "utf8");
const oldModel = `  if (!isOpenAiCompatiblePath(path)) return null;\n  const model = await readModel(request);`;
const newModel = `  if (!isOpenAiCompatiblePath(path)) return null;\n  const model =\n    merchantTokenFromStandardClient(request) === null\n      ? null\n      : await readModel(request);`;
if (source.includes(oldModel)) source = source.replace(oldModel, newModel);
else if (!source.includes(newModel)) throw new Error("auto-invoke model inference block not found");
writeFileSync(sourcePath, source);

const testPath = "tests/auto-invoke.test.ts";
let test = readFileSync(testPath, "utf8");
const geminiRequest = `      new Request(\`${'${ORIGIN}'}/v1/chat/completions\`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },`;
const geminiRequestHardened = `      new Request(\`${'${ORIGIN}'}/v1/chat/completions\`, {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          "X-Api-Key": \`xg_live_${'${"a".repeat(48)}'}\`,\n        },`;
const geminiTestStart = test.indexOf('  it("infers Gemini automatically from the model name"');
if (geminiTestStart < 0) throw new Error("Gemini inference test not found");
const geminiTestEnd = test.indexOf('\n  it(', geminiTestStart + 5);
const before = test.slice(0, geminiTestStart);
let geminiBlock = test.slice(geminiTestStart, geminiTestEnd < 0 ? test.length : geminiTestEnd);
if (geminiBlock.includes(geminiRequest) && !geminiBlock.includes('"X-Api-Key"'))
  geminiBlock = geminiBlock.replace(geminiRequest, geminiRequestHardened);
const after = geminiTestEnd < 0 ? "" : test.slice(geminiTestEnd);
test = before + geminiBlock + after;

const marker = '\n  it("recognizes Anthropic native SDK traffic without an XGuard-specific route", async () => {';
const block = `\n  it("does not inspect the model body for provider inference before XGuard authentication", async () => {\n    const route = await classifyAutoInvokeRoute(\n      new Request(\`${'${ORIGIN}'}/v1/chat/completions\`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          model: "gemini-3.6-flash",\n          messages: [{ role: "user", content: "hello" }],\n        }),\n      }),\n    );\n    expect(route).toMatchObject({\n      provider: "openai",\n      upstreamUrl: "https://api.openai.com/v1/chat/completions",\n    });\n  });\n`;
if (!test.includes("does not inspect the model body for provider inference before XGuard authentication")) {
  if (!test.includes(marker)) throw new Error("auto-invoke test insertion marker not found");
  test = test.replace(marker, block + marker);
}
writeFileSync(testPath, test);
