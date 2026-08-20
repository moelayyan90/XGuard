import { describe, expect, it } from "vitest";
import { childSafetyInstitutionalResponse } from "../apps/worker/src/child-safety-institutional.js";

describe("child safety institutional surface", () => {
  it("publishes compliance, pilot, pricing and reporting pages", async () => {
    for (const path of [
      "/child-safety/compliance",
      "/child-safety/pilot",
      "/child-safety/pricing",
      "/child-safety/reporting",
    ]) {
      const response = childSafetyInstitutionalResponse(
        new Request(`https://xguardgate.com${path}`),
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("permissions-policy")).toContain(
        "camera=()",
      );
    }
  });

  it("publishes a machine-readable institutional registry", async () => {
    const response = childSafetyInstitutionalResponse(
      new Request("https://xguardgate.com/v1/child-safety/institutional"),
    );
    expect(response).not.toBeNull();
    const body = (await response!.json()) as {
      commercialModel: string;
      pricing: Array<{ event: string }>;
      partners: Array<{ name: string }>;
    };
    expect(body.commercialModel).toContain("B2B/B2G");
    expect(body.pricing.some((row) => row.event === "video")).toBe(true);
    expect(body.partners.some((row) => row.name === "INHOPE")).toBe(true);
  });
});
