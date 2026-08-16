import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const MAX_DESCRIPTION_LENGTH = 512;
const MAX_SCHEMA_DEPTH = 20;
const MAX_SEARCH_TERMS = 8;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface BazaarCatalogOutcome {
  status: "success" | "rejected";
  rejectedReason?: string;
}

export interface BazaarListOptions {
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
  limit?: number;
  offset?: number;
}

export interface BazaarSearchOptions extends Omit<BazaarListOptions, "offset"> {
  query: string;
  cursor?: string;
}

interface CatalogEntry {
  resourceKey: string;
  resourceUrl: string;
  resourceType: "http" | "mcp";
  accepts: PaymentRequirements[];
  extensions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  payTo: string;
  scheme: string;
  network: string;
  toolName: string | null;
  searchText: string;
}

interface BazaarRow {
  resource_key: string;
  resource_url: string;
  resource_type: "http" | "mcp";
  x402_version: number;
  accepts_json: string;
  extensions_json: string;
  metadata_json: string;
  pay_to: string;
  scheme: string;
  network: string;
  tool_name: string | null;
  last_updated_epoch: number;
  successful_settlements: number;
}

export async function catalogBazaarPayment(
  db: D1Database,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  settled: boolean,
): Promise<BazaarCatalogOutcome | null> {
  const extracted = extractBazaarCatalogEntry(paymentPayload, paymentRequirements);
  if (extracted === null) return null;
  if ("rejectedReason" in extracted) {
    return { status: "rejected", rejectedReason: extracted.rejectedReason };
  }

  const entry = extracted.entry;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO bazaar_resources(
        resource_key,resource_url,resource_type,x402_version,accepts_json,
        extensions_json,metadata_json,pay_to,scheme,network,tool_name,
        search_text,first_seen_epoch,last_updated_epoch,successful_settlements
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(resource_key) DO UPDATE SET
        resource_url=excluded.resource_url,
        resource_type=excluded.resource_type,
        x402_version=excluded.x402_version,
        accepts_json=excluded.accepts_json,
        extensions_json=excluded.extensions_json,
        metadata_json=excluded.metadata_json,
        pay_to=excluded.pay_to,
        scheme=excluded.scheme,
        network=excluded.network,
        tool_name=excluded.tool_name,
        search_text=excluded.search_text,
        last_updated_epoch=excluded.last_updated_epoch,
        successful_settlements=bazaar_resources.successful_settlements + excluded.successful_settlements`,
    )
    .bind(
      entry.resourceKey,
      entry.resourceUrl,
      entry.resourceType,
      2,
      JSON.stringify(entry.accepts),
      JSON.stringify(entry.extensions),
      JSON.stringify(entry.metadata),
      entry.payTo,
      entry.scheme,
      entry.network,
      entry.toolName,
      entry.searchText,
      now,
      now,
      settled ? 1 : 0,
    )
    .run();

  return { status: "success" };
}

export function extractBazaarCatalogEntry(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): { entry: CatalogEntry } | { rejectedReason: string } | null {
  const payload = asRecord(paymentPayload);
  const extensions = asOptionalRecord(payload.extensions);
  const rawBazaar = extensions?.bazaar;
  if (rawBazaar === undefined) return null;

  const bazaar = asOptionalRecord(rawBazaar);
  if (bazaar === null) return { rejectedReason: "bazaar extension must be an object" };
  const info = asOptionalRecord(bazaar.info);
  const schema = asOptionalRecord(bazaar.schema);
  if (info === null || schema === null)
    return { rejectedReason: "bazaar.info and bazaar.schema are required objects" };
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema")
    return { rejectedReason: "bazaar schema must use JSON Schema Draft 2020-12" };
  if (!validateJsonSchema(info, schema))
    return { rejectedReason: "bazaar.info failed schema validation" };

  const resource = asOptionalRecord(payload.resource);
  if (resource === null)
    return { rejectedReason: "paymentPayload.resource is required for Bazaar cataloging" };
  const resourceUrl = canonicalResourceUrl(resource.url, bazaar.routeTemplate);
  if (resourceUrl === null)
    return { rejectedReason: "resource.url or routeTemplate is invalid" };

  const input = asOptionalRecord(info.input);
  if (input === null)
    return { rejectedReason: "bazaar.info.input is required" };
  const resourceType = input.type;
  if (resourceType !== "http" && resourceType !== "mcp")
    return { rejectedReason: "bazaar input.type must be http or mcp" };

  let toolName: string | null = null;
  if (resourceType === "http") {
    if (!isValidHttpInput(input))
      return { rejectedReason: "bazaar HTTP input is malformed" };
  } else {
    if (!isValidMcpInput(input))
      return { rejectedReason: "bazaar MCP input is malformed" };
    toolName = input.toolName as string;
  }

  const metadata = sanitizeResourceMetadata(resource);
  const description =
    typeof resource.description === "string"
      ? resource.description.slice(0, MAX_DESCRIPTION_LENGTH)
      : undefined;
  if (description !== undefined) metadata.description = description;
  if (typeof resource.mimeType === "string" && resource.mimeType.length <= 128)
    metadata.mimeType = resource.mimeType;

  const requirements = asRecord(paymentRequirements);
  const payTo = typeof requirements.payTo === "string" ? requirements.payTo : "";
  const scheme = typeof requirements.scheme === "string" ? requirements.scheme : "";
  const network = typeof requirements.network === "string" ? requirements.network : "";
  if (payTo === "" || scheme === "" || network === "")
    return { rejectedReason: "payment requirements are incomplete" };

  const resourceKey =
    resourceType === "mcp" ? `${resourceUrl}#mcp:${toolName}` : resourceUrl;
  const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]).join(" ") : "";
  const serviceName = typeof metadata.serviceName === "string" ? metadata.serviceName : "";
  const toolDescription =
    typeof input.description === "string" ? input.description.slice(0, 256) : "";
  const searchText = [
    resourceUrl,
    description ?? "",
    serviceName,
    tags,
    toolName ?? "",
    toolDescription,
    payTo,
    scheme,
    network,
  ]
    .join(" ")
    .toLowerCase();

  return {
    entry: {
      resourceKey,
      resourceUrl,
      resourceType,
      accepts: [paymentRequirements],
      extensions: { bazaar },
      metadata,
      payTo,
      scheme,
      network,
      toolName,
      searchText,
    },
  };
}

export async function listBazaarResources(db: D1Database, options: BazaarListOptions) {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const { whereSql, binds } = buildFilters(options);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM bazaar_resources ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();
  const result = await db
    .prepare(
      `SELECT * FROM bazaar_resources ${whereSql}
       ORDER BY last_updated_epoch DESC, resource_key ASC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<BazaarRow>();

  const items = result.results.map(rowToResource);
  return {
    x402Version: 2,
    items,
    resources: items,
    pagination: { limit, offset, total: totalRow?.total ?? 0 },
  };
}

export async function searchBazaarResources(db: D1Database, options: BazaarSearchOptions) {
  const limit = clampLimit(options.limit);
  const offset = decodeCursor(options.cursor);
  const terms = options.query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);
  if (terms.length === 0) throw new Error("search_query_required");

  const { whereSql: filterSql, binds } = buildFilters(options);
  const clauses = terms.map(() => "search_text LIKE ? ESCAPE '\\'");
  const termBinds = terms.map((term) => `%${escapeLike(term)}%`);
  const prefix = filterSql === "" ? "WHERE" : `${filterSql} AND`;
  const whereSql = `${prefix} ${clauses.join(" AND ")}`;

  const result = await db
    .prepare(
      `SELECT * FROM bazaar_resources ${whereSql}
       ORDER BY successful_settlements DESC, last_updated_epoch DESC, resource_key ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, ...termBinds, limit + 1, offset)
    .all<BazaarRow>();
  const hasMore = result.results.length > limit;
  const resources = result.results.slice(0, limit).map(rowToResource);
  return {
    x402Version: 2,
    resources,
    items: resources,
    partialResults: hasMore,
    pagination: {
      limit,
      cursor: hasMore ? encodeCursor(offset + limit) : null,
    },
  };
}

export async function findBazaarResource(db: D1Database, resource: string) {
  const result = await db
    .prepare(
      `SELECT * FROM bazaar_resources
       WHERE resource_url = ? OR resource_key = ?
       ORDER BY successful_settlements DESC, last_updated_epoch DESC LIMIT 20`,
    )
    .bind(resource, resource)
    .all<BazaarRow>();
  return result.results.map(rowToResource);
}

export async function bazaarStats(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS resources,
              COALESCE(SUM(CASE WHEN resource_type='mcp' THEN 1 ELSE 0 END),0) AS mcp,
              COALESCE(SUM(CASE WHEN resource_type='http' THEN 1 ELSE 0 END),0) AS http,
              COALESCE(SUM(successful_settlements),0) AS successfulSettlements
       FROM bazaar_resources`,
    )
    .first<{ resources: number; mcp: number; http: number; successfulSettlements: number }>();
  return {
    resources: row?.resources ?? 0,
    mcpResources: row?.mcp ?? 0,
    httpResources: row?.http ?? 0,
    successfulSettlementObservations: row?.successfulSettlements ?? 0,
  };
}

export function validateJsonSchema(
  value: unknown,
  schemaValue: unknown,
  depth = 0,
): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  const schema = asOptionalRecord(schemaValue);
  if (schema === null) return false;
  if ("$ref" in schema || "dynamicRef" in schema) return false;

  if (Array.isArray(schema.allOf))
    if (!schema.allOf.every((part) => validateJsonSchema(value, part, depth + 1))) return false;
  if (Array.isArray(schema.anyOf))
    if (!schema.anyOf.some((part) => validateJsonSchema(value, part, depth + 1))) return false;
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((part) => validateJsonSchema(value, part, depth + 1));
    if (matches.length !== 1) return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(item, value))) return false;
  if ("const" in schema && !jsonEqual(schema.const, value)) return false;

  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) return false;
  if (Array.isArray(type) && !type.some((candidate) => typeof candidate === "string" && matchesType(value, candidate)))
    return false;

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string") {
      if (schema.pattern.length > 128) return false;
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) return false;
      } catch {
        return false;
      }
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.items !== undefined)
      if (!value.every((item) => validateJsonSchema(item, schema.items, depth + 1))) return false;
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    if (required.some((key) => !(key in value))) return false;
    const properties = asOptionalRecord(schema.properties) ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) {
        if (!validateJsonSchema(item, properties[key], depth + 1)) return false;
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (isRecord(schema.additionalProperties)) {
        if (!validateJsonSchema(item, schema.additionalProperties, depth + 1)) return false;
      }
    }
  }

  return true;
}

function isValidHttpInput(input: Record<string, unknown>): boolean {
  if (input.type !== "http" || typeof input.method !== "string") return false;
  const method = input.method.toUpperCase();
  if (["GET", "HEAD", "DELETE"].includes(method)) return true;
  if (!["POST", "PUT", "PATCH"].includes(method)) return false;
  return (
    typeof input.bodyType === "string" &&
    ["json", "form-data", "text"].includes(input.bodyType) &&
    input.body !== undefined
  );
}

function isValidMcpInput(input: Record<string, unknown>): boolean {
  if (input.type !== "mcp" || typeof input.toolName !== "string" || input.toolName.length === 0)
    return false;
  if (!isRecord(input.inputSchema)) return false;
  if (input.transport !== undefined && input.transport !== "streamable-http" && input.transport !== "sse")
    return false;
  return true;
}

function canonicalResourceUrl(rawUrl: unknown, rawTemplate: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (isForbiddenHost(url.hostname)) return null;
  if (typeof rawTemplate === "string" && isValidRouteTemplate(rawTemplate))
    return `${url.origin}${rawTemplate}`;
  url.hash = "";
  return url.toString();
}

function isValidRouteTemplate(value: string): boolean {
  if (value.length === 0 || !value.startsWith("/")) return false;
  if (!/^\/[a-zA-Z0-9_/:.\-~%]+$/.test(value)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  return !decoded.includes("..") && !decoded.includes("://");
}

function sanitizeResourceMetadata(resource: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (isPrintableAscii(resource.serviceName, 32)) metadata.serviceName = resource.serviceName;
  if (Array.isArray(resource.tags)) {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const raw of resource.tags) {
      if (!isPrintableAscii(raw, 32)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(raw);
      if (tags.length === 5) break;
    }
    if (tags.length > 0) metadata.tags = tags;
  }
  if (isValidIconUrl(resource.iconUrl)) metadata.iconUrl = resource.iconUrl;
  return metadata;
}

function isPrintableAscii(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[\x20-\x7E]+$/.test(value)
  );
}

function isValidIconUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username === "" &&
    url.password === "" &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    !isForbiddenHost(url.hostname)
  );
}

function isForbiddenHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  try {
    host = decodeURIComponent(host);
  } catch {
    return true;
  }
  if (["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"].includes(host))
    return true;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

function buildFilters(options: BazaarListOptions) {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (options.type !== undefined) {
    clauses.push("resource_type = ?");
    binds.push(options.type);
  }
  if (options.payTo !== undefined) {
    clauses.push("LOWER(pay_to) = LOWER(?)");
    binds.push(options.payTo);
  }
  if (options.scheme !== undefined) {
    clauses.push("scheme = ?");
    binds.push(options.scheme);
  }
  if (options.network !== undefined) {
    clauses.push("network = ?");
    binds.push(options.network);
  }
  if (options.extensions !== undefined) {
    if (options.extensions !== "bazaar") clauses.push("1 = 0");
  }
  return {
    whereSql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    binds,
  };
}

function rowToResource(row: BazaarRow) {
  const extensions = safeParseJson(row.extensions_json, {});
  const metadata = safeParseJson(row.metadata_json, {});
  return {
    resource: row.resource_url,
    type: row.resource_type,
    x402Version: row.x402_version,
    accepts: safeParseJson(row.accepts_json, []),
    lastUpdated: row.last_updated_epoch,
    extensions,
    metadata,
    ...(row.tool_name === null ? {} : { toolName: row.tool_name }),
    successfulSettlements: row.successful_settlements,
  };
}

function clampLimit(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, value as number));
}

function clampOffset(value: number | undefined): number {
  if (!Number.isInteger(value) || (value as number) < 0) return 0;
  return value as number;
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }));
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  try {
    const parsed = JSON.parse(atob(cursor)) as { offset?: unknown };
    return typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset >= 0
      ? parsed.offset
      : 0;
  } catch {
    return 0;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function safeParseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
