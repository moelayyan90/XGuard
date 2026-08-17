export const XGUARD_PRODUCTION_GATEWAY_URL = "https://xguardgate.com";

export function resolveXGuardGatewayUrl(configuredUrl?: string): string {
  return configuredUrl ?? XGUARD_PRODUCTION_GATEWAY_URL;
}
