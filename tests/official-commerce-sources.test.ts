import { describe, expect, it } from "vitest";
import {
  convertMoneyToUsd,
  parseEcbFxCsv,
  parseOcdsReleasePackage,
  parseTedSearchResponse,
} from "../apps/worker/src/official-commerce-sources.js";

const ECB = [
  "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
  "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-08-21,0.8",
  "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-21,1.2",
].join("\n");

describe("official commerce sources", () => {
  it("normalizes GBP through the same ECB EUR reference frame", () => {
    const fx = parseEcbFxCsv(ECB);
    expect(fx.usdPerEur).toBe(1.2);
    expect(convertMoneyToUsd(100, "GBP", fx)).toBe(150);
    expect(convertMoneyToUsd(100, "USD", fx)).toBe(100);
    expect(convertMoneyToUsd(100, "JPY", fx)).toBeNull();
  });

  it("turns an active OCDS tender into demand without pretending funding is secured", () => {
    const fx = parseEcbFxCsv(ECB);
    const result = parseOcdsReleasePackage(
      {
        releases: [
          {
            id: "080077-2026",
            ocid: "ocds-h6vhtk-06e9ed",
            date: "2026-08-21T16:31:23+01:00",
            tag: ["tender"],
            buyer: { id: "BUYER-1", name: "North Council" },
            parties: [
              {
                id: "BUYER-1",
                name: "North Council",
                roles: ["buyer"],
                address: { countryName: "United Kingdom" },
                contactPoint: { email: "procurement@example.gov.uk" },
              },
            ],
            tender: {
              id: "ABC",
              title: "Software support",
              status: "active",
              classification: {
                scheme: "CPV",
                id: "48000000",
                description: "Software package and information systems",
              },
              value: { amount: 800000, currency: "GBP" },
              tenderPeriod: { endDate: "2027-09-11T12:00:00+01:00" },
            },
          },
        ],
      },
      "uk-find-a-tender",
      "UK Find a Tender",
      fx,
    );

    expect(result.demands).toHaveLength(1);
    expect(result.vendors).toHaveLength(0);
    expect(result.demands[0]).toMatchObject({
      productKey: "CPV-48000000",
      buyerEmail: "procurement@example.gov.uk",
      unit: "contract",
      targetUnitPriceUsd: 1_200_000,
      evidenceLevel: 95,
    });
    expect(result.demands[0]?.paymentTerms).toContain(
      "not independently verified",
    );
    expect(result.demands[0]?.paymentTerms.toLowerCase()).not.toContain(
      "advance",
    );
    expect(result.demands[0]?.paymentTerms.toLowerCase()).not.toContain(
      "escrow",
    );
  });

  it("stores awarded suppliers as candidates, never as live offers", () => {
    const fx = parseEcbFxCsv(ECB);
    const result = parseOcdsReleasePackage(
      {
        releases: [
          {
            id: "080097-2026",
            ocid: "ocds-h6vhtk-06e9f8",
            date: "2026-08-21T17:11:02+01:00",
            tag: ["award", "contract"],
            tender: {
              title: "Palo Alto Contract Variation",
              status: "complete",
              classification: {
                scheme: "CPV",
                id: "48000000",
                description: "Software package and information systems",
              },
            },
            parties: [
              {
                id: "SUPPLIER-1",
                name: "CDW Ltd",
                roles: ["supplier"],
                address: { countryName: "United Kingdom" },
                contactPoint: { email: "sales@example.com" },
              },
            ],
            awards: [
              {
                id: "award-1",
                status: "active",
                date: "2026-08-07T00:00:00+01:00",
                suppliers: [{ id: "SUPPLIER-1", name: "CDW Ltd" }],
              },
            ],
            contracts: [
              {
                awardID: "award-1",
                value: { amount: 80_000, currency: "GBP" },
              },
            ],
          },
        ],
      },
      "uk-find-a-tender",
      "UK Find a Tender",
      fx,
    );

    expect(result.demands).toHaveLength(0);
    expect(result.vendors).toHaveLength(1);
    expect(result.vendors[0]).toMatchObject({
      supplierName: "CDW Ltd",
      supplierEmail: "sales@example.com",
      productKey: "CPV-48000000",
      referenceValueUsd: 120_000,
      evidenceLevel: 85,
    });
  });

  it("parses TED fields without treating notice value as secured cash", () => {
    const fx = parseEcbFxCsv(ECB);
    const result = parseTedSearchResponse(
      {
        notices: [
          {
            "publication-number": "417571-2026",
            "notice-title": { eng: "Infrastructure services" },
            "buyer-name": ["Example authority"],
            "buyer-email": ["buyer@example.eu"],
            "classification-cpv": ["71300000"],
            "total-value": [100_000],
            "total-value-cur": ["EUR"],
            "deadline-date-lot": ["2027-08-21"],
          },
        ],
      },
      fx,
    );

    expect(result.demands).toHaveLength(1);
    expect(result.demands[0]).toMatchObject({
      sourceName: "EU TED",
      productKey: "CPV-71300000",
      buyerEmail: "buyer@example.eu",
      targetUnitPriceUsd: 120_000,
    });
    expect(result.demands[0]?.paymentTerms).toContain(
      "not independently verified",
    );
  });
});
