import { describe, expect, it } from "vitest";
import {
  XGUARD_PRODUCTION_GATEWAY_URL,
  resolveXGuardGatewayUrl,
} from "../packages/cli/src/defaults.js";

describe("CLI production gateway default", () => {
  it("defaults migrations to xguard-mainnet", () => {
    expect(XGUARD_PRODUCTION_GATEWAY_URL).toBe("https://xguardgate.com");
    expect(resolveXGuardGatewayUrl()).toBe(XGUARD_PRODUCTION_GATEWAY_URL);
  });

  it("still permits an explicit gateway override", () => {
    expect(resolveXGuardGatewayUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });
});
