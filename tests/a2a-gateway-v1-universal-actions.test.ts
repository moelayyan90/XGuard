import { describe, expect, it } from "vitest";
import { a2aGatewayV1Response } from "../apps/worker/src/a2a-gateway-v1.js";

const ORIGIN = "https://xguardgate.com";
const env = {} as unknown as {
  DB: D1Database;
  XGUARD_TREASURY_USDC_ADDRESS?: string;
  XGUARD_TOOL_FEE_MICRO_USD?: string;
};
const delegate = async () => new Response("not-used", { status: 500 });

describe("XGuard A2A universal action discovery", () => {
  it("advertises universal actions as a first-class agent skill", async () => {
    const response = await a2aGatewayV1Response(
      new Request(`${ORIGIN}/.well-known/agent-card.json`),
      env,
      delegate,
    );

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      description: string;
      skills: Array<{
        id: string;
        description: string;
        tags?: string[];
      }>;
      xguardDiscovery: { actions: string; execute: string };
    };
    const skill = body.skills.find((item) => item.id === "universal-actions");

    expect(body.description).toContain("Universal guarded action execution");
    expect(skill?.description).toContain("public HTTPS API action");
    expect(skill?.tags).toContain("workflow");
    expect(skill?.tags).toContain("booking");
    expect(body.xguardDiscovery.actions).toBe(
      `${ORIGIN}/.well-known/xguard/actions.json`,
    );
    expect(body.xguardDiscovery.execute).toBe(`${ORIGIN}/v1/actions/execute`);
  });

  it("publishes the action discovery endpoint on the A2A probe", async () => {
    const response = await a2aGatewayV1Response(
      new Request(`${ORIGIN}/a2a`),
      env,
      delegate,
    );
    const body = (await response!.json()) as { universalActions: string };
    expect(body.universalActions).toBe(
      `${ORIGIN}/.well-known/xguard/actions.json`,
    );
  });
});
