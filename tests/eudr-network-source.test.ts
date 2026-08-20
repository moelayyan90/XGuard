import { describe, expect, it, vi } from "vitest";
import { eudrNetworkResponse } from "../apps/worker/src/eudr-network.js";

function env() {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({ success: true })),
        })),
      })),
    } as unknown as D1Database,
    XGUARD_ADMIN_TOKEN_SHA256: undefined,
  };
}

describe("EUDR network", () => {
  it("makes the EUDR readiness message the primary landing surface", async () => {
    const response = await eudrNetworkResponse(new Request("https://xguardgate.com/"), env());
    expect(response?.status).toBe(200);
    const body = await response!.text();
    expect(body).toContain("90% is readiness");
    expect(body).toContain("XGuard EUDR Inbox");
    expect(body).toContain("not an EU institution");
  });

  it("reports 90% readiness after nine explicit preparation checks", async () => {
    const response = await eudrNetworkResponse(
      new Request("https://xguardgate.com/v1/eudr/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeMapped: true,
          rolesConfirmed: true,
          suppliersMapped: true,
          cnCodesMapped: true,
          geolocationReady: true,
          sourceDataMapped: true,
          retentionPolicyReady: true,
          euCredentialsReady: true,
          testFlowCompleted: true,
        }),
      }),
      env(),
    );
    expect(response?.status).toBe(200);
    await expect(response!.json()).resolves.toMatchObject({
      readinessPercent: 90,
      remainingExecutionPercent: 10,
      completed: 9,
    });
  });
});
