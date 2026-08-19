export type ChildSafetyContentKind =
  | "message"
  | "chat_window"
  | "ad_text"
  | "image_description"
  | "video_transcript";

export type ChildSafetyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ChildSafetyAction =
  "ALLOW" | "WARN" | "BLUR" | "BLOCK" | "FREEZE_CHAT" | "ESCALATE";

export interface ChildSafetyScanInput {
  eventId: string;
  riskSessionId?: string;
  contentKind: ChildSafetyContentKind;
  language?: string;
  childLikely?: boolean;
  childAgeBand?: string;
  text: string;
  signals?: string[];
}

export interface ChildSafetyEnforcement {
  blockContent?: boolean;
  blurMedia?: boolean;
  freezeConversation?: boolean;
  preventFurtherContact?: boolean;
  suppressAd?: boolean;
  disableAutoplay?: boolean;
  stopVideoPlayback?: boolean;
  quarantineActor?: boolean;
  requireHumanSafetyReview?: boolean;
  surfaceReportFlow?: boolean;
  preserveClientSideEvidence?: boolean;
}

export interface ChildSafetyScanResult {
  eventId: string;
  contentKind: ChildSafetyContentKind;
  riskLevel: ChildSafetyRiskLevel;
  confidence?: number;
  categories: string[];
  primaryAction: ChildSafetyAction;
  enforcement: ChildSafetyEnforcement;
  rationale?: string;
  priorHighRiskEventsInSession?: number;
  feeUsd: string;
  rawContentStored: false;
  reporting?: unknown;
  idempotentReplay?: boolean;
}

export interface ChildSafetyClientOptions {
  /** XGuard gateway origin, for example https://xguardgate.com. */
  url: string;
  /** Server-side XGuard merchant API key. Never expose this key in browser code. */
  apiKey: string;
  /** Optional custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
  /** Optional request timeout. Defaults to 8 seconds. */
  timeoutMs?: number;
}

export interface ChildSafetyHooks {
  onWarn?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onBlur?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onBlock?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onFreezeConversation?: (
    result: ChildSafetyScanResult,
  ) => void | Promise<void>;
  onPreventFurtherContact?: (
    result: ChildSafetyScanResult,
  ) => void | Promise<void>;
  onSuppressAd?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onDisableAutoplay?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onStopVideoPlayback?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onQuarantineActor?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onHumanReview?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onReportFlow?: (result: ChildSafetyScanResult) => void | Promise<void>;
  onPreserveEvidence?: (result: ChildSafetyScanResult) => void | Promise<void>;
}

export interface ChildSafetyClient {
  scan(input: ChildSafetyScanInput): Promise<ChildSafetyScanResult>;
  enforce(
    result: ChildSafetyScanResult,
    hooks: ChildSafetyHooks,
  ): Promise<ChildSafetyScanResult>;
  scanAndEnforce(
    input: ChildSafetyScanInput,
    hooks: ChildSafetyHooks,
  ): Promise<ChildSafetyScanResult>;
}

export class ChildSafetyApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`XGuard child-safety request failed with HTTP ${status}`);
    this.name = "ChildSafetyApiError";
    this.status = status;
    this.body = body;
  }
}

export function createChildSafetyClient(
  options: ChildSafetyClientOptions,
): ChildSafetyClient {
  const baseUrl = normalizeBaseUrl(options.url);
  const apiKey = options.apiKey.trim();
  if (!/^xg_live_[A-Za-z0-9_-]{40,}$/.test(apiKey)) {
    throw new TypeError("A valid XGuard merchant API key is required");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const scan = async (
    input: ChildSafetyScanInput,
  ): Promise<ChildSafetyScanResult> => {
    validateScanInput(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/v1/child-safety/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-XGuard-SDK": "@xguard/sdk-child-safety/0.1",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ChildSafetyApiError(response.status, body);
      return validateScanResult(body);
    } finally {
      clearTimeout(timeout);
    }
  };

  const enforce = async (
    result: ChildSafetyScanResult,
    hooks: ChildSafetyHooks,
  ): Promise<ChildSafetyScanResult> => {
    const e = result.enforcement ?? {};

    if (result.primaryAction === "WARN" && hooks.onWarn)
      await hooks.onWarn(result);
    if (e.blurMedia && hooks.onBlur) await hooks.onBlur(result);
    if (e.blockContent && hooks.onBlock) await hooks.onBlock(result);
    if (e.freezeConversation && hooks.onFreezeConversation)
      await hooks.onFreezeConversation(result);
    if (e.preventFurtherContact && hooks.onPreventFurtherContact)
      await hooks.onPreventFurtherContact(result);
    if (e.suppressAd && hooks.onSuppressAd) await hooks.onSuppressAd(result);
    if (e.disableAutoplay && hooks.onDisableAutoplay)
      await hooks.onDisableAutoplay(result);
    if (e.stopVideoPlayback && hooks.onStopVideoPlayback)
      await hooks.onStopVideoPlayback(result);
    if (e.quarantineActor && hooks.onQuarantineActor)
      await hooks.onQuarantineActor(result);
    if (e.requireHumanSafetyReview && hooks.onHumanReview)
      await hooks.onHumanReview(result);
    if (e.surfaceReportFlow && hooks.onReportFlow)
      await hooks.onReportFlow(result);
    if (e.preserveClientSideEvidence && hooks.onPreserveEvidence)
      await hooks.onPreserveEvidence(result);

    return result;
  };

  return {
    scan,
    enforce,
    async scanAndEnforce(input, hooks) {
      const result = await scan(input);
      return enforce(result, hooks);
    },
  };
}

function normalizeBaseUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  if (
    !/^https:\/\//.test(url) &&
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?$/.test(url)
  ) {
    throw new TypeError(
      "XGuard URL must use HTTPS, except for localhost development",
    );
  }
  return url;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return 8_000;
  if (!Number.isSafeInteger(value) || value < 500 || value > 60_000)
    throw new TypeError("timeoutMs must be an integer between 500 and 60000");
  return value;
}

function validateScanInput(input: ChildSafetyScanInput): void {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.eventId))
    throw new TypeError("eventId must be 8-160 URL-safe characters");
  if (
    input.riskSessionId !== undefined &&
    !/^[A-Za-z0-9._:-]{8,160}$/.test(input.riskSessionId)
  ) {
    throw new TypeError("riskSessionId must be 8-160 URL-safe characters");
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0)
    throw new TypeError("text is required");
  if (input.text.length > 20_000)
    throw new TypeError("text must not exceed 20000 characters");
}

function validateScanResult(value: unknown): ChildSafetyScanResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid XGuard child-safety response");
  const result = value as Partial<ChildSafetyScanResult>;
  if (
    typeof result.eventId !== "string" ||
    typeof result.contentKind !== "string" ||
    typeof result.riskLevel !== "string" ||
    typeof result.primaryAction !== "string" ||
    !result.enforcement ||
    typeof result.enforcement !== "object" ||
    !Array.isArray(result.categories) ||
    typeof result.feeUsd !== "string" ||
    result.rawContentStored !== false
  ) {
    throw new TypeError("Invalid XGuard child-safety response contract");
  }
  return result as ChildSafetyScanResult;
}
