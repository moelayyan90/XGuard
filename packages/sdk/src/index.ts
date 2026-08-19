import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/http";

export * from "./auto-pay.js";
export * from "./child-safety-media.js";
export * from "./child-safety.js";
export * from "./hosted-auto-pay.js";

export interface XGuardClientOptions {
  /** XGuard gateway origin, without /verify or /settle. */
  url: string;
  /** Merchant API key. Required by production mainnet; omit only for an explicit public testnet gateway. */
  apiKey?: string;
  /** Hard deadline for each downstream facilitator operation. */
  timeoutMs?: number;
  /** Optional fetch-safe request correlation identifier. */
  clientVersion?: string;
}

export function createXGuardFacilitator(
  options: XGuardClientOptions,
): FacilitatorClient {
  const url = options.url.replace(/\/+$/, "");
  if (
    !/^https:\/\//.test(url) &&
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?$/.test(url)
  ) {
    throw new TypeError(
      "XGuard URL must use HTTPS, except for localhost development",
    );
  }
  const createAuthHeaders = async () => {
    const headers: Record<string, string> = {
      "X-XGuard-SDK": options.clientVersion ?? "@xguard/sdk/0.1.0-alpha.1",
    };
    if (options.apiKey !== undefined)
      headers.Authorization = `Bearer ${options.apiKey}`;
    return {
      verify: headers,
      settle: headers,
      supported: headers,
      bazaar: headers,
    };
  };
  return new HTTPFacilitatorClient({
    url,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    createAuthHeaders,
  });
}

export const XGUARD_DEFAULT_FEE_USD = "0.002000";
