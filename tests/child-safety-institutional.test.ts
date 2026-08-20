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

  it("makes age assurance and regulatory readiness discoverable from the institutional home", async () => {
    const response = childSafetyInstitutionalResponse(
      new Request("https://xguardgate.com/child-safety"),
    );
    expect(response?.status).toBe(200);
    const body = await response!.text();
    expect(body).toContain("/child-safety/age-assurance");
    expect(body).toContain("/child-safety/regulatory-readiness");
    expect(body).toContain("Protect children. Prove the control. Preserve privacy.");
  });

  it("publishes a machine-readable institutional registry", async () => {
    const response = childSafetyInstitutionalResponse(
      new Request("https://xguardgate.com/v1/child-safety/institutional"),
    );
    expect(response).not.toBeNull();
    const body = (await response!.json()) as {
      product: string;
      commercialModel: string;
      certificationStatus: string;
      pricing: Array<{ event: string }>;
      partners: Array<{ name: string }>;
      regulatorySurfaces: string[];
    };
    expect(body.product).toContain("Compliance Infrastructure");
    expect(body.commercialModel).toContain("B2B/B2G");
    expect(body.certificationStatus).toBe("not_certified_or_government_approved");
    expect(body.pricing.some((row) => row.event === "video")).toBe(true);
    expect(body.partners.some((row) => row.name === "INHOPE")).toBe(true);
    expect(body.regulatorySurfaces).toContain(
      "/v1/child-safety/regulator-pack",
    );
  });
});