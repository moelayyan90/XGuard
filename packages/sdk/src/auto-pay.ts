export interface X402PaymentRequirementsLike {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export interface X402PaymentCreationContextLike {
  paymentRequired: {
    x402Version: number;
    resource?: {
      url?: string;
      serviceName?: string;
    };
  };
  selectedRequirements: X402PaymentRequirementsLike;
}

export type X402BeforePaymentCreationHook = (
  context: X402PaymentCreationContextLike,
) => Promise<void | { abort: true; reason: string }>;

export interface X402HookableClient {
  onBeforePaymentCreation(hook: X402BeforePaymentCreationHook): unknown;
}

export interface XGuardAutomatedPaymentBudget {
  /** Exact network or a prefix pattern ending in `*`, for example `eip155:*`. */
  network: string;
  /** Exact x402 asset identifier. */
  asset: string;
  /** Maximum atomic amount allowed for one automatically-created payment. */
  maxAtomicAmountPerPayment: string;
  /** Optional conservative cap across authorized attempts inside the window. */
  maxAtomicAmountPerWindow?: string;
  /** Window length in milliseconds. Defaults to 24 hours. */
  windowMs?: number;
}

export interface XGuardAutomatedPaymentIntent {
  x402Version: number;
  resourceUrl: string;
  serviceName?: string;
  scheme: string;
  network: string;
  asset: string;
  amountAtomic: string;
  payTo: string;
}

export interface XGuardAutomatedPaymentDecision {
  allow: boolean;
  reason?: string;
}

export interface XGuardAutomatedPaymentOptions {
  /** Must be explicitly set to `auto`; XGuard never silently enables automated payment. */
  mode: "auto";
  /** Optional network allowlist. Supports exact values and trailing-* prefix patterns. */
  allowedNetworks?: string[];
  /** Optional exact scheme allowlist. */
  allowedSchemes?: string[];
  /** Optional exact payee allowlist. Address comparison is case-insensitive. */
  allowedPayees?: string[];
  /** At least one budget is required unless `allowUnbudgetedAssets` is true. */
  budgets?: XGuardAutomatedPaymentBudget[];
  /** Explicit escape hatch for callers that intentionally rely on another spend-control layer. */
  allowUnbudgetedAssets?: boolean;
  /** Require an HTTPS resource URL before a payment can be created. Defaults to true. */
  requireHttpsResource?: boolean;
  /** Optional remote or local policy callback. Returning false blocks before signing. */
  authorize?: (
    intent: XGuardAutomatedPaymentIntent,
  ) => Promise<boolean | XGuardAutomatedPaymentDecision>;
  /** Optional audit callback. It receives only payment intent metadata, never signing material. */
  onDecision?: (
    decision: XGuardAutomatedPaymentDecision & {
      intent: XGuardAutomatedPaymentIntent;
    },
  ) => void | Promise<void>;
  /** Test hook for deterministic rolling-window accounting. */
  now?: () => number;
}

export interface XGuardAutomatedPaymentGuard {
  readonly client: X402HookableClient;
  getAttemptSpend(): Readonly<Record<string, string>>;
  resetAttemptSpend(): void;
}

type WindowState = {
  startedAt: number;
  amount: bigint;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function embedXGuardAutomatedPayments(
  client: X402HookableClient,
  options: XGuardAutomatedPaymentOptions,
): XGuardAutomatedPaymentGuard {
  if (!client || typeof client.onBeforePaymentCreation !== "function") {
    throw new TypeError(
      "XGuard automated payments require an x402 client with onBeforePaymentCreation()",
    );
  }
  if (options.mode !== "auto") {
    throw new TypeError(
      "XGuard automated payment mode must be explicitly set to auto",
    );
  }

  const budgets = (options.budgets ?? []).map(validateBudget);
  if (!budgets.length && options.allowUnbudgetedAssets !== true) {
    throw new TypeError(
      "XGuard automated payments require a budget or allowUnbudgetedAssets: true",
    );
  }

  const now = options.now ?? Date.now;
  const windows = new Map<string, WindowState>();

  client.onBeforePaymentCreation(async (context) => {
    const intent = normalizeIntent(context);
    let decision = evaluateStaticPolicy(
      intent,
      options,
      budgets,
      windows,
      now(),
    );

    if (decision.allow && options.authorize) {
      try {
        const external = await options.authorize(intent);
        decision =
          typeof external === "boolean"
            ? {
                allow: external,
                ...(external
                  ? {}
                  : { reason: "XGuard authorization denied payment" }),
              }
            : normalizeDecision(external);
      } catch (error) {
        decision = {
          allow: false,
          reason: `XGuard authorization failed: ${safeError(error)}`,
        };
      }
    }

    if (decision.allow) {
      reserveAttempt(intent, budgets, windows, now());
    }

    await options.onDecision?.({ ...decision, intent });
    if (!decision.allow) {
      return {
        abort: true,
        reason: decision.reason ?? "XGuard blocked automated payment",
      };
    }
    return undefined;
  });

  return {
    client,
    getAttemptSpend() {
      const result: Record<string, string> = {};
      for (const [key, value] of windows) result[key] = value.amount.toString();
      return result;
    },
    resetAttemptSpend() {
      windows.clear();
    },
  };
}

function evaluateStaticPolicy(
  intent: XGuardAutomatedPaymentIntent,
  options: XGuardAutomatedPaymentOptions,
  budgets: XGuardAutomatedPaymentBudget[],
  windows: Map<string, WindowState>,
  timestamp: number,
): XGuardAutomatedPaymentDecision {
  if (
    (options.requireHttpsResource ?? true) &&
    !isHttpsUrl(intent.resourceUrl)
  ) {
    return { allow: false, reason: "XGuard requires an HTTPS x402 resource" };
  }

  if (
    options.allowedNetworks?.length &&
    !options.allowedNetworks.some((pattern) =>
      matchesPattern(intent.network, pattern),
    )
  ) {
    return { allow: false, reason: `Network not allowed: ${intent.network}` };
  }

  if (
    options.allowedSchemes?.length &&
    !options.allowedSchemes.includes(intent.scheme)
  ) {
    return { allow: false, reason: `Scheme not allowed: ${intent.scheme}` };
  }

  if (
    options.allowedPayees?.length &&
    !options.allowedPayees.some(
      (payee) => payee.toLowerCase() === intent.payTo.toLowerCase(),
    )
  ) {
    return { allow: false, reason: "Payee is not allowlisted" };
  }

  const budget = findBudget(intent, budgets);
  if (!budget) {
    return options.allowUnbudgetedAssets === true
      ? { allow: true }
      : {
          allow: false,
          reason: "No XGuard budget matches this network and asset",
        };
  }

  const amount = parseAtomic(intent.amountAtomic, "payment amount");
  const perPayment = parseAtomic(
    budget.maxAtomicAmountPerPayment,
    "maxAtomicAmountPerPayment",
  );
  if (amount > perPayment) {
    return {
      allow: false,
      reason: "Payment exceeds XGuard per-payment budget",
    };
  }

  if (budget.maxAtomicAmountPerWindow !== undefined) {
    const maxWindow = parseAtomic(
      budget.maxAtomicAmountPerWindow,
      "maxAtomicAmountPerWindow",
    );
    const key = budgetKey(budget);
    const state = activeWindow(windows.get(key), budget, timestamp);
    if (state.amount + amount > maxWindow) {
      return {
        allow: false,
        reason: "Payment exceeds XGuard rolling-window budget",
      };
    }
  }

  return { allow: true };
}

function reserveAttempt(
  intent: XGuardAutomatedPaymentIntent,
  budgets: XGuardAutomatedPaymentBudget[],
  windows: Map<string, WindowState>,
  timestamp: number,
): void {
  const budget = findBudget(intent, budgets);
  if (!budget?.maxAtomicAmountPerWindow) return;
  const key = budgetKey(budget);
  const state = activeWindow(windows.get(key), budget, timestamp);
  state.amount += parseAtomic(intent.amountAtomic, "payment amount");
  windows.set(key, state);
}

function activeWindow(
  current: WindowState | undefined,
  budget: XGuardAutomatedPaymentBudget,
  timestamp: number,
): WindowState {
  const windowMs = budget.windowMs ?? DAY_MS;
  if (!current || timestamp - current.startedAt >= windowMs) {
    return { startedAt: timestamp, amount: 0n };
  }
  return { ...current };
}

function normalizeIntent(
  context: X402PaymentCreationContextLike,
): XGuardAutomatedPaymentIntent {
  const selected = context.selectedRequirements;
  if (!selected || typeof selected !== "object") {
    throw new TypeError("XGuard received invalid x402 payment requirements");
  }
  const resourceUrl = String(context.paymentRequired?.resource?.url ?? "");
  const serviceName = context.paymentRequired?.resource?.serviceName;
  return {
    x402Version: Number(context.paymentRequired?.x402Version ?? 0),
    resourceUrl,
    ...(typeof serviceName === "string" && serviceName
      ? { serviceName: serviceName.slice(0, 160) }
      : {}),
    scheme: requiredString(selected.scheme, "scheme"),
    network: requiredString(selected.network, "network"),
    asset: requiredString(selected.asset, "asset"),
    amountAtomic: parseAtomic(selected.amount, "payment amount").toString(),
    payTo: requiredString(selected.payTo, "payTo"),
  };
}

function validateBudget(
  value: XGuardAutomatedPaymentBudget,
): XGuardAutomatedPaymentBudget {
  const network = requiredString(value.network, "budget network");
  const asset = requiredString(value.asset, "budget asset");
  const maxAtomicAmountPerPayment = parseAtomic(
    value.maxAtomicAmountPerPayment,
    "maxAtomicAmountPerPayment",
  ).toString();
  const maxAtomicAmountPerWindow =
    value.maxAtomicAmountPerWindow === undefined
      ? undefined
      : parseAtomic(
          value.maxAtomicAmountPerWindow,
          "maxAtomicAmountPerWindow",
        ).toString();
  if (
    value.windowMs !== undefined &&
    (!Number.isSafeInteger(value.windowMs) || value.windowMs <= 0)
  ) {
    throw new TypeError(
      "XGuard budget windowMs must be a positive safe integer",
    );
  }
  return {
    network,
    asset,
    maxAtomicAmountPerPayment,
    ...(maxAtomicAmountPerWindow === undefined
      ? {}
      : { maxAtomicAmountPerWindow }),
    ...(value.windowMs === undefined ? {} : { windowMs: value.windowMs }),
  };
}

function findBudget(
  intent: XGuardAutomatedPaymentIntent,
  budgets: XGuardAutomatedPaymentBudget[],
): XGuardAutomatedPaymentBudget | undefined {
  return budgets.find(
    (budget) =>
      matchesPattern(intent.network, budget.network) &&
      budget.asset === intent.asset,
  );
}

function budgetKey(budget: XGuardAutomatedPaymentBudget): string {
  return `${budget.network}|${budget.asset}`;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseAtomic(value: string, label: string): bigint {
  const normalized = String(value).trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw new TypeError(
      `XGuard ${label} must be a non-negative integer string`,
    );
  }
  const amount = BigInt(normalized);
  if (amount <= 0n)
    throw new TypeError(`XGuard ${label} must be greater than zero`);
  return amount;
}

function requiredString(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`XGuard ${label} is required`);
  return normalized;
}

function normalizeDecision(
  value: XGuardAutomatedPaymentDecision,
): XGuardAutomatedPaymentDecision {
  if (!value || typeof value.allow !== "boolean") {
    return {
      allow: false,
      reason: "XGuard authorization returned an invalid decision",
    };
  }
  return {
    allow: value.allow,
    ...(typeof value.reason === "string" && value.reason
      ? { reason: value.reason.slice(0, 240) }
      : {}),
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "unknown error";
}
