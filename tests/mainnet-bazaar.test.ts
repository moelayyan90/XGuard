import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  extractBazaarCatalogEntry,
  validateJsonSchema,
} from "../apps/worker/src/mainnet-bazaar.js";

const requirements = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
} as PaymentRequirements;

const mcpInfo = {
  input: {
    type: "mcp",
    toolName: "company_research",
    description: "Research a company",
    transport: "streamable-http",
    inputSchema: {
      type: "object",
      properties: { company: { type: "string" } },
      required: ["company"],
    },
    example: { company: "OpenAI" },
  },
  output: { type: "json", example: { summary: "..." } },
};

const mcpSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    input: {
      type: "object",
      properties: {
        type: { type: "string", const: "mcp" },
        toolName: { type: "string" },
        description: { type: "string" },
        transport: { type: "string", enum: ["streamable-http", "sse"] },
        inputSchema: { type: "object" },
        example: { type: "object" },
      },
      required: ["type", "toolName", "inputSchema"],
      additionalProperties: false,
    },
    output: { type: "object" },
  },
  required: ["input"],
};

function paymentPayload(
  extension: unknown = { info: mcpInfo, schema: mcpSchema },
) {
  return {
    x402Version: 2,
    resource: {
      url: "https://tools.example.com/mcp",
      description: "Paid research tools",
      mimeType: "application/json",
      serviceName: "Example Research",
      tags: ["research", "agents", "RESEARCH"],
      iconUrl: "https://tools.example.com/icon.png",
    },
    accepted: requirements,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: "1",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
    extensions: { bazaar: extension },
  } as unknown as PaymentPayload;
}

describe("mainnet Bazaar extraction", () => {
  it("catalogs an MCP tool with the MCP tuple as its unique key", () => {
    const result = extractBazaarCatalogEntry(paymentPayload(), requirements);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("entry");
    if (result === null || !("entry" in result)) return;
    expect(result.entry.resourceType).toBe("mcp");
    expect(result.entry.resourceUrl).toBe("https://tools.example.com/mcp");
    expect(result.entry.resourceKey).toBe(
      "https://tools.example.com/mcp#mcp:company_research",
    );
    expect(result.entry.toolName).toBe("company_research");
    expect(result.entry.metadata.tags).toEqual(["research", "agents"]);
  });

  it("rejects a double-wrapped Bazaar extension", () => {
    const result = extractBazaarCatalogEntry(
      paymentPayload({ bazaar: { info: mcpInfo, schema: mcpSchema } }),
      requirements,
    );
    expect(result).toEqual({
      rejectedReason: "bazaar.info and bazaar.schema are required objects",
    });
  });

  it("rejects insecure resource URLs on mainnet", () => {
    const payload = paymentPayload() as unknown as Record<string, unknown>;
    payload.resource = {
      url: "http://127.0.0.1/mcp",
      description: "bad",
    };
    const result = extractBazaarCatalogEntry(
      payload as unknown as PaymentPayload,
      requirements,
    );
    expect(result).toEqual({
      rejectedReason: "resource.url or routeTemplate is invalid",
    });
  });
});

describe("Bazaar JSON Schema validation", () => {
  it("validates the canonical MCP info subset", () => {
    expect(validateJsonSchema(mcpInfo, mcpSchema)).toBe(true);
  });

  it("accepts same-document JSON Pointer refs", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { input: { $ref: "#/$defs/input" } },
      required: ["input"],
      $defs: {
        input: {
          type: "object",
          properties: {
            type: { const: "mcp" },
            toolName: { type: "string" },
            inputSchema: { type: "object" },
          },
          required: ["type", "toolName", "inputSchema"],
          additionalProperties: true,
        },
      },
    };
    expect(validateJsonSchema(mcpInfo, schema)).toBe(true);
  });

  it("rejects external refs and ids without resolving them", () => {
    expect(
      validateJsonSchema(mcpInfo, {
        ...mcpSchema,
        properties: { input: { $ref: "https://evil.example/schema.json" } },
      }),
    ).toBe(false);
    expect(
      validateJsonSchema(mcpInfo, {
        ...mcpSchema,
        $id: "file:///tmp/schema.json",
      }),
    ).toBe(false);
  });

  it("rejects info that violates a required const", () => {
    expect(
      validateJsonSchema(
        {
          ...mcpInfo,
          input: { ...mcpInfo.input, type: "http" },
        },
        mcpSchema,
      ),
    ).toBe(false);
  });
});

describe("Bazaar SQL stays aligned with its migration", () => {
  it("does not reference removed catalog columns", () => {
    const source = readFileSync(
      new URL("../apps/worker/src/mainnet-bazaar.ts", import.meta.url),
      "utf8",
    );
    const migration = readFileSync(
      new URL(
        "../apps/worker/migrations/0005_bazaar_discovery.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).not.toContain("successful_settlements");
    expect(source).not.toContain("successful_settlements");
  });
});
