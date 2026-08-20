import { describe, expect, it } from "vitest";
import { publicChildSafetySiteResponse } from "../apps/worker/src/child-safety-public-site.js";

describe("child safety public site", () => {
  it("states the anti-surveillance boundary on the public landing page", async () => {
    const response = publicChildSafetySiteResponse(
      new Request("https://xguardgate.com/child-safety"),
    );
    expect(response?.status).toBe(200);
    const body = await response?.text();
    expect(body).toContain("Protect children.");
    expect(body).toContain("Not monitor childhood.");
    expect(body).toContain("not a surveillance system");
    expect(body).toContain("No authority backdoor");
    expect(response?.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("publishes a rights and government brief", async () => {
    const rights = publicChildSafetySiteResponse(
      new Request("https://xguardgate.com/child-safety/rights"),
    );
    expect(await rights?.text()).toContain("No secret parent surveillance");

    const governments = publicChildSafetySiteResponse(
      new Request("https://xguardgate.com/child-safety/governments"),
    );
    const body = await governments?.text();
    expect(body).toContain("We are not a child surveillance authority");
    expect(body).toContain("No mass interception");
    expect(body).toContain("No hidden government access");
  });

  it("publishes machine-readable principles", async () => {
    const response = publicChildSafetySiteResponse(
      new Request("https://xguardgate.com/v1/child-safety/principles"),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      remoteThirdPartyMonitoring: boolean;
      authorityBackdoor: boolean;
      rawConversationLedgerStorage: boolean;
      notFor: string[];
    };
    expect(body.remoteThirdPartyMonitoring).toBe(false);
    expect(body.authorityBackdoor).toBe(false);
    expect(body.rawConversationLedgerStorage).toBe(false);
    expect(body.notFor).toContain("mass surveillance");
  });

  it("does not claim unrelated routes", () => {
    expect(
      publicChildSafetySiteResponse(
        new Request("https://xguardgate.com/v1/balance"),
      ),
    ).toBeNull();
  });
});
