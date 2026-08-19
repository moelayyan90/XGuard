import { describe, expect, it, vi } from "vitest";
import { migrationAssistanceResponse } from "../apps/worker/src/migration-assistance.js";

function env() {
  return {
    DB: {} as D1Database,
    AI: { run: vi.fn() },
    MIGRATION_OPERATION_FEE_MICRO_USD: "3000000",
  };
}

describe("XGuard migration assistance", () => {
  it("serves the migrant assistance portal at root", async () => {
    const response = await migrationAssistanceResponse(
      new Request("https://xguard.global/"),
      env(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    const html = await response!.text();
    expect(html).toContain("Migration Assistance");
    expect(html).toContain("$3 per completed paid operation");
    expect(html).toContain("Undocumented / irregular status");
  });

  it("publishes an exact three-dollar paid-operation quote", async () => {
    const response = await migrationAssistanceResponse(
      new Request("https://xguard.global/v1/migration/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "translate_document" }),
      }),
      env(),
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      billable: boolean;
      pricing: { usd: string; microUsd: number };
    };
    expect(body.billable).toBe(true);
    expect(body.pricing.usd).toBe("3.00");
    expect(body.pricing.microUsd).toBe(3_000_000);
  });

  it("keeps first-line protection and legal-aid routing free", async () => {
    const testEnv = env();
    const response = await migrationAssistanceResponse(
      new Request("https://xguard.global/v1/migration/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "safety_and_legal_aid",
          currentCountry: "Germany",
          migrationStatus: "Undocumented / irregular status",
        }),
      }),
      testEnv,
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      billable: boolean;
      safetyBoundary: string;
    };
    expect(body.billable).toBe(false);
    expect(body.safetyBoundary).toContain("lawful procedures");
    expect(testEnv.AI.run).not.toHaveBeenCalled();
  });

  it("refuses to invent a country-specific plan without verified official sources", async () => {
    const testEnv = env();
    const response = await migrationAssistanceResponse(
      new Request("https://xguard.global/v1/migration/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "build_personalized_plan",
          language: "Arabic",
          currentCountry: "Germany",
          goal: "Apply for asylum",
        }),
      }),
      testEnv,
    );

    expect(response?.status).toBe(422);
    const body = (await response!.json()) as { error: string };
    expect(body.error).toBe("verified_official_source_required");
    expect(testEnv.AI.run).not.toHaveBeenCalled();
  });

  it("requires authenticated funded payment context before a paid operation", async () => {
    const testEnv = env();
    const response = await migrationAssistanceResponse(
      new Request("https://xguard.global/v1/migration/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "translate_document",
          language: "Arabic",
          text: "Official document text",
        }),
      }),
      testEnv,
    );

    expect(response?.status).toBe(402);
    const body = (await response!.json()) as {
      error: string;
      pricing: { usd: string; microUsd: number };
    };
    expect(body.error).toBe("migration_payment_required");
    expect(body.pricing.usd).toBe("3.00");
    expect(body.pricing.microUsd).toBe(3_000_000);
    expect(testEnv.AI.run).not.toHaveBeenCalled();
  });
});
