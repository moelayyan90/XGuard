import { describe, expect, it } from "vitest";
import { childSafetyReportingDirectoryResponse } from "../apps/worker/src/child-safety-reporting-directory.js";

describe("XGuard global child-safety reporting directory", () => {
  it("returns a verified Jordan child-support route plus global fallbacks", async () => {
    const response = childSafetyReportingDirectoryResponse(
      new Request(
        "https://xguardgate.com/v1/child-safety/reporting-directory?country=JO",
      ),
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      verifiedAt: string;
      local: Array<{ countryCode: string; value: string; source: string }>;
      global: Array<{ id: string }>;
      evidenceBoundary: string;
    };

    expect(body.verifiedAt).toBe("2026-08-20");
    expect(body.local).toHaveLength(1);
    expect(body.local[0]?.countryCode).toBe("JO");
    expect(body.local[0]?.value).toBe("110");
    expect(body.local[0]?.source).toContain("childhelplineinternational.org");
    expect(body.global.map((item) => item.id)).toContain("inhope");
    expect(body.global.map((item) => item.id)).toContain("ncmec-cybertipline");
    expect(body.evidenceBoundary).toContain(
      "Do not send child sexual abuse material",
    );
  });

  it("does not invent a direct phone number when the authoritative directory does not publish one", async () => {
    const response = childSafetyReportingDirectoryResponse(
      new Request(
        "https://xguardgate.com/v1/child-safety/reporting-directory?country=EG",
      ),
    );
    const body = (await response?.json()) as {
      local: Array<{ channel: string; value: string }>;
    };

    expect(body.local).toHaveLength(1);
    expect(body.local[0]?.channel).toBe("directory");
    expect(body.local[0]?.value).toContain("childhelplineinternational.org");
  });

  it("renders the reporting directory page with strict evidence-handling guidance", async () => {
    const response = childSafetyReportingDirectoryResponse(
      new Request("https://xguardgate.com/child-safety/reporting-directory"),
    );
    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain("Get the right help");
    expect(html).toContain("Do not send abuse material to XGuard");
    expect(html).toContain("800 700");
  });

  it("ignores unrelated routes", () => {
    expect(
      childSafetyReportingDirectoryResponse(
        new Request("https://xguardgate.com/healthz"),
      ),
    ).toBeNull();
  });
});
