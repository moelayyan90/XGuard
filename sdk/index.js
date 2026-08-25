import { HTTPFacilitatorClient } from "@x402/core/server";

export const XGUARD_FACILITATOR_URL = "https://api.xguardgate.com";

export function xguardFacilitatorConfig(options = {}) {
  const { licenseKey = "", timeoutMs = 30_000 } = options;
  return {
    url: XGUARD_FACILITATOR_URL,
    timeoutMs,
    createAuthHeaders: async () => {
      const settle = licenseKey
        ? { Authorization: `Bearer ${licenseKey}` }
        : {};
      return {
        supported: {},
        verify: {},
        settle,
      };
    },
  };
}

export function createXGuardFacilitator(options = {}) {
  return new HTTPFacilitatorClient(xguardFacilitatorConfig(options));
}

export async function xguardSupported() {
  const response = await fetch(`${XGUARD_FACILITATOR_URL}/supported`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`XGuard /supported failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function xguardHealth() {
  const response = await fetch(`${XGUARD_FACILITATOR_URL}/healthz`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`XGuard /healthz failed with HTTP ${response.status}`);
  }
  return response.json();
}
