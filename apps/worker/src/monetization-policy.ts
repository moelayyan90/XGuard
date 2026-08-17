import type { GatewayEventKind } from "./universal-gateway-billing.js";

const FREE_MCP_TOOLS = new Set(["xguard_status"]);

export interface McpBillingDescriptor {
  name: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
}

export interface MonetizationFeeEnv {
  XGUARD_MODEL_FEE_MICRO_USD?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
  XGUARD_SOURCE_FEE_MICRO_USD?: string;
  XGUARD_ANALYSIS_FEE_MICRO_USD?: string;
  XGUARD_SECURITY_FEE_MICRO_USD?: string;
}

export function classifyMcpToolCall(
  payload: unknown,
): McpBillingDescriptor | null {
  if (!isRecord(payload) || payload.method !== "tools/call") return null;
  const params = isRecord(payload.params) ? payload.params : null;
  const name =
    params !== null && typeof params.name === "string" ? params.name : "";
  if (name === "" || FREE_MCP_TOOLS.has(name)) return null;

  if (name === "xguard_discover" || name === "xguard_resource_details")
    return {
      name,
      kind: "SOURCE",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  if (name.includes("security"))
    return {
      name,
      kind: "SECURITY",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  if (name.includes("analy"))
    return {
      name,
      kind: "ANALYSIS",
      provider: "xguard-mcp",
      operation: `mcp.${name}`,
    };

  return {
    name,
    kind: "TOOL",
    provider: "xguard-mcp",
    operation: `mcp.${name}`,
  };
}

export function feeForMcpKind(
  env: MonetizationFeeEnv,
  kind: GatewayEventKind,
): number {
  if (kind === "MODEL")
    return configuredFee(
      env.XGUARD_MODEL_FEE_MICRO_USD,
      100,
      "XGUARD_MODEL_FEE_MICRO_USD",
    );
  if (kind === "TOOL")
    return configuredFee(
      env.XGUARD_TOOL_FEE_MICRO_USD,
      200,
      "XGUARD_TOOL_FEE_MICRO_USD",
    );
  if (kind === "SOURCE")
    return configuredFee(
      env.XGUARD_SOURCE_FEE_MICRO_USD,
      1_000,
      "XGUARD_SOURCE_FEE_MICRO_USD",
    );
  if (kind === "ANALYSIS")
    return configuredFee(
      env.XGUARD_ANALYSIS_FEE_MICRO_USD,
      2_000,
      "XGUARD_ANALYSIS_FEE_MICRO_USD",
    );
  return configuredFee(
    env.XGUARD_SECURITY_FEE_MICRO_USD,
    1_000,
    "XGUARD_SECURITY_FEE_MICRO_USD",
  );
}

export function configuredFee(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = raw ?? String(fallback);
  if (!/^[0-9]+$/.test(value)) throw new Error(`invalid_${name.toLowerCase()}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 1_000_000)
    throw new Error(`invalid_${name.toLowerCase()}`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
