import { describe, expect, it } from "vitest";
import { eudrSmartEmployeeSite } from "../apps/worker/src/eudr-smart-employee-site.js";
import { operationsEmployeeResponse } from "../apps/worker/src/operations-employee.js";

const env = {
  DB: {} as D1Database,
  XGUARD_ADMIN_TOKEN_SHA256: undefined,
};

describe("XGuard smart operations employee", () => {
  it("presents the cross-border employee positioning on the public site", async () => {
    const response = eudrSmartEmployeeSite(
      new Request("https://xguardgate.com/"),
    );
    expect(response?.status).toBe(200);
    const body = await response!.text();
    expect(body).toContain("smart cross-border operations employee");
    expect(body).toContain("does not get tired");
    expect(body).toContain("Mood has no place in the workflow");
    expect(body).toContain("€9");
    expect(body).toContain("independent software service");
  });

  it("publishes only truthful workflow capability states", async () => {
    const response = await operationsEmployeeResponse(
      new Request("https://xguardgate.com/v1/operations/catalog"),
      env,
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      workflows: Array<{
        id: string;
        status: string;
        executionBoundary: string;
      }>;
    };
    expect(body.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "eudr_operations",
          status: "focused_launch",
        }),
        expect.objectContaining({
          id: "cross_border_task_intake",
          status: "foundation",
        }),
      ]),
    );
    expect(body.workflows[0]?.executionBoundary.length).toBeGreaterThan(20);
  });

  it("does not allow public creation of customer organisations", async () => {
    const response = await operationsEmployeeResponse(
      new Request("https://xguardgate.com/v1/operations/organisations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Example Importer",
          contactEmail: "ops@example.com",
        }),
      }),
      env,
    );
    expect(response?.status).toBe(401);
  });
});
