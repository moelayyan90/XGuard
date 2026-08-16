import fs from "node:fs";

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`patch failed: ${label}`);
  return next;
}

const bazaarPath = "apps/worker/src/mainnet-bazaar.ts";
let bazaar = fs.readFileSync(bazaarPath, "utf8");

bazaar = replaceRequired(
  bazaar,
  'import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";\n',
  'import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";\nimport Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";\n',
  "Ajv import",
);
bazaar = bazaar.replace(
  "const MAX_SCHEMA_DEPTH = 20;",
  'const MAX_SCHEMA_BYTES = 64 * 1024;\nconst MAX_SCHEMA_NODES = 512;\nconst ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: false });',
);
bazaar = bazaar.replace("  successful_settlements: number;\n", "");
bazaar = bazaar.replace("  settled: boolean,\n", "");
bazaar = bazaar.replace(
  "        search_text,first_seen_epoch,last_updated_epoch,successful_settlements\n      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  "        search_text,first_seen_epoch,last_updated_epoch\n      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
);
bazaar = bazaar.replace(
  ",\n        search_text=excluded.search_text,\n        last_updated_epoch=excluded.last_updated_epoch,\n        successful_settlements=bazaar_resources.successful_settlements + excluded.successful_settlements`,",
  ",\n        search_text=excluded.search_text,\n        last_updated_epoch=excluded.last_updated_epoch`,",
);
bazaar = bazaar.replace("      settled ? 1 : 0,\n", "");
bazaar = bazaar.replaceAll(
  "ORDER BY successful_settlements DESC, last_updated_epoch DESC, resource_key ASC",
  "ORDER BY last_updated_epoch DESC, resource_key ASC",
);
bazaar = bazaar.replace(
  "              COALESCE(SUM(CASE WHEN resource_type='http' THEN 1 ELSE 0 END),0) AS http,\n              COALESCE(SUM(successful_settlements),0) AS successfulSettlements\n       FROM bazaar_resources`,\n    )\n    .first<{ resources: number; mcp: number; http: number; successfulSettlements: number }>();",
  "              COALESCE(SUM(CASE WHEN resource_type='http' THEN 1 ELSE 0 END),0) AS http\n       FROM bazaar_resources`,\n    )\n    .first<{ resources: number; mcp: number; http: number }>();",
);
bazaar = bazaar.replace(
  "    httpResources: row?.http ?? 0,\n    successfulSettlementObservations: row?.successfulSettlements ?? 0,",
  "    httpResources: row?.http ?? 0,",
);
bazaar = bazaar.replace(
  "    ...(row.tool_name === null ? {} : { toolName: row.tool_name }),\n    successfulSettlements: row.successful_settlements,",
  "    ...(row.tool_name === null ? {} : { toolName: row.tool_name }),",
);

const validatorStart = bazaar.indexOf("export function validateJsonSchema(");
const validatorEnd = bazaar.indexOf("function isValidHttpInput", validatorStart);
if (validatorStart < 0 || validatorEnd < 0) throw new Error("validator block not found");
const validator = `export function validateJsonSchema(\n  value: unknown,\n  schemaValue: unknown,\n): boolean {\n  const schema = asOptionalRecord(schemaValue);\n  if (schema === null) return false;\n  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") return false;\n  if (!schemaReferencesAreLocal(schema)) return false;\n\n  try {\n    const serialized = JSON.stringify(schema);\n    if (new TextEncoder().encode(serialized).byteLength > MAX_SCHEMA_BYTES) return false;\n    const validate = ajv.compile(schema);\n    if (!validate(value)) return false;\n    return schemaEnforcesBazaarContract(validate, value);\n  } catch {\n    return false;\n  }\n}\n\nfunction schemaReferencesAreLocal(root: unknown): boolean {\n  const stack: unknown[] = [root];\n  let nodes = 0;\n  while (stack.length > 0) {\n    const value = stack.pop();\n    if (++nodes > MAX_SCHEMA_NODES) return false;\n    if (Array.isArray(value)) {\n      for (const item of value) stack.push(item);\n      continue;\n    }\n    if (!isRecord(value)) continue;\n    for (const [key, item] of Object.entries(value)) {\n      if (key === "$ref" || key === "$id") {\n        if (typeof item !== "string" || !(item === "#" || item.startsWith("#/")))\n          return false;\n      }\n      if (key === "$dynamicRef") {\n        if (typeof item !== "string" || !item.startsWith("#")) return false;\n      }\n      stack.push(item);\n    }\n  }\n  return true;\n}\n\nfunction schemaEnforcesBazaarContract(\n  validate: ValidateFunction,\n  value: unknown,\n): boolean {\n  if (!isRecord(value) || !isRecord(value.input)) return false;\n  const input = value.input;\n\n  const withoutInput = structuredClone(value);\n  delete withoutInput.input;\n  if (validate(withoutInput)) return false;\n\n  const wrongType = structuredClone(value);\n  if (!isRecord(wrongType.input)) return false;\n  wrongType.input.type = input.type === "mcp" ? "http" : "mcp";\n  if (validate(wrongType)) return false;\n\n  if (input.type === "mcp") {\n    for (const required of ["toolName", "inputSchema"] as const) {\n      const mutation = structuredClone(value);\n      if (!isRecord(mutation.input)) return false;\n      delete mutation.input[required];\n      if (validate(mutation)) return false;\n    }\n    return true;\n  }\n\n  if (input.type === "http") {\n    const wrongMethod = structuredClone(value);\n    if (!isRecord(wrongMethod.input)) return false;\n    wrongMethod.input.method = "TRACE";\n    if (validate(wrongMethod)) return false;\n\n    if (["POST", "PUT", "PATCH"].includes(String(input.method).toUpperCase())) {\n      for (const required of ["bodyType", "body"] as const) {\n        const mutation = structuredClone(value);\n        if (!isRecord(mutation.input)) return false;\n        delete mutation.input[required];\n        if (validate(mutation)) return false;\n      }\n    }\n    return true;\n  }\n\n  return false;\n}\n\n`;
bazaar = bazaar.slice(0, validatorStart) + validator + bazaar.slice(validatorEnd);

// Helpers made obsolete by Ajv.
bazaar = bazaar.replace(/\nfunction matchesType\([\s\S]*?\nfunction jsonEqual\([\s\S]*?\n}\n(?=\nfunction isRecord)/, "\n");
fs.writeFileSync(bazaarPath, bazaar);

const migrationPath = "apps/worker/migrations/0005_bazaar_discovery.sql";
let migration = fs.readFileSync(migrationPath, "utf8");
migration = migration.replace(
  ",\n  successful_settlements INTEGER NOT NULL DEFAULT 0 CHECK(successful_settlements >= 0)",
  "",
);
fs.writeFileSync(migrationPath, migration);

const edgePath = "apps/worker/src/mainnet-edge.ts";
let edge = fs.readFileSync(edgePath, "utf8");
edge = edge.replace('name: "io.xguard/mainnet"', 'name: "io.github.moelayyan90/xguard"');
edge = edge.replace(
  /if \(request\.method === "OPTIONS" && isPublicEdgePath\(url\.pathname\)\) \{\n\s*return corsResponse\(new Response\(null, \{ status: 204 \}\)\);\n\s*\}/,
  `if (request.method === "OPTIONS" && url.pathname === "/mcp") {\n      const originError = validateMcpOrigin(request);\n      if (originError !== null) return originError;\n      return corsResponse(new Response(null, { status: 204 }));\n    }\n\n    if (request.method === "OPTIONS" && isPublicEdgePath(url.pathname)) {\n      return corsResponse(new Response(null, { status: 204 }));\n    }`,
);
edge = edge.replace(
  /await catalogBazaarPayment\(\n\s*env\.DB,\n\s*parsed\.paymentPayload,\n\s*parsed\.paymentRequirements,\n\s*operation === "\/settle" && !replayed,\n\s*\)/,
  `await catalogBazaarPayment(\n      env.DB,\n      parsed.paymentPayload,\n      parsed.paymentRequirements,\n    )`,
);
edge = edge.replace(
  '  const replayed = response.headers.get("X-XGuard-Replayed") === "true";\n',
  "",
);
fs.writeFileSync(edgePath, edge);

const architecturePath = "ARCHITECTURE.md";
let architecture = fs.readFileSync(architecturePath, "utf8");
architecture = architecture.replace(
  "- successful non-replayed settlements increment the resource's observed successful-settlement counter;\n",
  "",
);
fs.writeFileSync(architecturePath, architecture);

const testsPath = "tests/mainnet-bazaar.test.ts";
let tests = fs.readFileSync(testsPath, "utf8");
const marker = `  it("rejects info that violates a required const", () => {`;
const extraTests = `  it("accepts same-document JSON Pointer refs", () => {\n    const schema = {\n      $schema: "https://json-schema.org/draft/2020-12/schema",\n      type: "object",\n      properties: { input: { $ref: "#/$defs/input" } },\n      required: ["input"],\n      $defs: {\n        input: {\n          type: "object",\n          properties: {\n            type: { const: "mcp" },\n            toolName: { type: "string" },\n            inputSchema: { type: "object" },\n          },\n          required: ["type", "toolName", "inputSchema"],\n          additionalProperties: true,\n        },\n      },\n    };\n    expect(validateJsonSchema(mcpInfo, schema)).toBe(true);\n  });\n\n  it("rejects external refs and ids without resolving them", () => {\n    expect(\n      validateJsonSchema(mcpInfo, {\n        ...mcpSchema,\n        properties: { input: { $ref: "https://evil.example/schema.json" } },\n      }),\n    ).toBe(false);\n    expect(\n      validateJsonSchema(mcpInfo, {\n        ...mcpSchema,\n        $id: "file:///tmp/schema.json",\n      }),\n    ).toBe(false);\n  });\n\n`;
if (!tests.includes("accepts same-document JSON Pointer refs")) {
  tests = replaceRequired(tests, marker, extraTests + marker, "Bazaar ref tests");
}
fs.writeFileSync(testsPath, tests);

const smokePath = "scripts/smoke-mainnet.mjs";
let smoke = fs.readFileSync(smokePath, "utf8");
const smokeMarker = `assert(mcp.body.result?.capabilities?.tools !== undefined, "MCP tools capability is missing");`;
const toolsSmoke = `\n\nconst tools = await json("/mcp", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    Accept: "application/json, text/event-stream",\n    "MCP-Protocol-Version": "2025-11-25",\n  },\n  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),\n});\nassert(tools.response.status === 200, "MCP tools/list failed");\nassert(\n  Array.isArray(tools.body.result?.tools) &&\n    tools.body.result.tools.some((tool) => tool?.name === "xguard_discover"),\n  "MCP xguard_discover tool is missing",\n);`;
if (!smoke.includes("MCP tools/list failed")) {
  smoke = replaceRequired(smoke, smokeMarker, smokeMarker + toolsSmoke, "MCP tools smoke");
}
fs.writeFileSync(smokePath, smoke);
