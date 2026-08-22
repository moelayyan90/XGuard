import { describe, expect, it } from "vitest";
import {
  childSafetyComplianceInfrastructureResponse,
  evaluateAgeAssurance,
} from "../apps/worker/src/child-safety-compliance-infrastructure.js";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

function validEvidence() {
  return {
    eventId: "event-age-12345",
    providerId: "eu-av-verifier",
    proofReference: "opaque-proof-reference-12345",
    method: "eu_av_openid4vp",
    ageThreshold: 18,
    result: "meets_threshold",
    verificationStatus: "verified_by_provider",
    providerTrust: "contracted",
    issuedAt: "2026-08-20T11:55:00.000Z",
    expiresAt: "2026-08-20T12:30:00.000Z",
    presentationProtocol: "openid4vp_1_0",
    technicalAccuracyEvaluated: true,
    robustnessTested: true,
    reliabilityMonitored: true,
    fairnessEvaluated: true,
    thirdPartyScrutiny: true,
    privacyPreserving: true,
    exactAgeDisclosedToXGuard: false,
    identityDisclosedToXGuard: false,
    jurisdiction: "EU",
  };
}

describe("child safety compliance infrastructure", () => {
  it("publishes machine-readable regulatory and age-assurance surfaces", async () => {
    for (const path of [
      "/v1/child-safety/compliance-profile",
      "/v1/child-safety/age-assurance/schema",
      "/v1/child-safety/regulator-pack",
    ]) {
      const response = await childSafetyComplianceInfrastructureResponse(
        new Request(`https://xguardgate.com${path}`),
        { DB: {} as D1Database },
      );
      expect(response?.status).toBe(200);
    }
  });

  it("publishes regulator-facing review pages with browser permissions disabled", async () => {
    for (const path of [
      "/child-safety/age-assurance",
      "/child-safety/regulatory-readiness",
    ]) {
      const response = await childSafetyComplianceInfrastructureResponse(
        new Request(`https://xguardgate.com${path}`),
        { DB: {} as D1Database },
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("permissions-policy")).toContain("camera=()");
    }
  });

  it("builds an EU/UK evidence profile without retaining proof or identity", () => {
    const result = evaluateAgeAssurance(validEvidence(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const age = result.value.ageAssurance as Record<string, unknown>;
    const evidence = result.value.evidence as Record<string, unknown>;
    const boundary = result.value.trustBoundary as Record<string, unknown>;

    expect(result.value.policySignal).toBe("THRESHOLD_MET");
    expect(age.proofReferenceRetained).toBe(false);
    expect(age.rawProofRetained).toBe(false);
    expect(age.exactAgeRetained).toBe(false);
    expect(age.rawIdentityDocumentRetained).toBe(false);
    expect(evidence.ukHeaaEvidenceComplete).toBe(true);
    expect(evidence.euBlueprintEvidenceComplete).toBe(true);
    expect(boundary.independentCryptographicVerificationPerformedByXGuard).toBe(false);
    expect(JSON.stringify(result.value)).not.toContain("opaque-proof-reference-12345");
  });

  it("rejects raw identity fields instead of becoming an identity database", () => {
    const result = evaluateAgeAssurance(
      { ...validEvidence(), dateOfBirth: "2000-01-01" },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: "raw_identity_field_forbidden:dateOfBirth",
    });
  });

  it("does not turn caller-declared evidence into a compliance conclusion", () => {
    const result = evaluateAgeAssurance(
      {
        ...validEvidence(),
        verificationStatus: "not_verified",
        providerTrust: "trusted_listed",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.policySignal).toBe("INSUFFICIENT_EVIDENCE");
    const evidence = result.value.evidence as Record<string, unknown>;
    expect(evidence.ukHeaaEvidenceComplete).toBe(false);
    expect(evidence.euBlueprintEvidenceComplete).toBe(false);
  });

  it("rejects expired age evidence", () => {
    const result = evaluateAgeAssurance(
      { ...validEvidence(), expiresAt: "2026-08-20T11:59:00.000Z" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "age_evidence_expired" });
  });
});
