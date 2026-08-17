export const XGUARD_PRODUCTION_GATEWAY_URL =
  "https://xguard-mainnet.maqamapp.workers.dev";

export function resolveXGuardGatewayUrl(
  configuredUrl?: string,
): string {
  return configuredUrl ?? XGUARD_PRODUCTION_GATEWAY_URL;
}
