from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


x402 = "apps/worker/src/zero-friction-x402.ts"

replace_once(
    x402,
    '''  XGUARD_TREASURY_USDC_ADDRESS: string;\n  XGUARD_FEE_MICRO_USD: string;\n  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;''',
    '''  XGUARD_TREASURY_USDC_ADDRESS: string;\n  XGUARD_PRICING_VERSION?: string;\n  XGUARD_FEE_BPS?: string;\n  XGUARD_FEE_CAP_MICRO_USD?: string;\n  XGUARD_FEE_MICRO_USD: string;\n  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;''',
)

replace_once(
    x402,
    '''    const parsed = await parseMainnetFacilitatorRequest(request);\n    const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);\n    const debtBlock = dueBlock(account, env);\n    if (debtBlock !== null) return debtBlock;\n\n    return withProtection(request, env, account.payTo, async () => {\n      const result = await xPayVerify(env, parsed.raw, parsed.payer);\n      return json(result, 200, feeHeaders(account, env, "not-charged"));\n    });''',
    '''    const parsed = await parseMainnetFacilitatorRequest(request);\n    return withProtection(request, env, parsed.payTo, async () => {\n      const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);\n      const debtBlock = dueBlock(account);\n      if (debtBlock !== null) return debtBlock;\n      const result = await xPayVerify(env, parsed.raw, parsed.payer);\n      return json(result, 200, feeHeaders(account, "not-charged"));\n    });''',
)

replace_once(
    x402,
    '''    const parsed = await parseMainnetFacilitatorRequest(request);\n    network = parsed.paymentRequirements.network;\n    const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);\n    const debtBlock = dueBlock(account, env);\n    if (debtBlock !== null) return debtBlock;\n\n    return withProtection(request, env, account.payTo, async () =>\n      settleProtected(parsed, account, env, ctx),\n    );''',
    '''    const parsed = await parseMainnetFacilitatorRequest(request);\n    network = parsed.paymentRequirements.network;\n    return withProtection(request, env, parsed.payTo, async () => {\n      const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);\n      const debtBlock = dueBlock(account);\n      if (debtBlock !== null) return debtBlock;\n      return settleProtected(parsed, account, env, ctx);\n    });''',
)

replace_once(
    x402,
    '''      ...feeHeaders(account, env, "already-accounted"),''',
    '''      ...feeHeaders(account, "already-accounted"),''',
)
replace_once(
    x402,
    '''      ...feeHeaders(account, env, "not-charged"),''',
    '''      ...feeHeaders(account, "not-charged"),''',
)
replace_once(
    x402,
    '''    ...feeHeaders(account, env, "pending-finality"),''',
    '''    ...feeHeaders(account, "pending-finality"),''',
)

replace_once(
    x402,
    '''    const payTo = new URL(request.url).searchParams.get("payTo") ?? "";\n    const account = await ensureZeroFrictionMerchant(env.DB, payTo);\n    return json(feeBalanceBody(account, env));''',
    '''    const payTo = new URL(request.url).searchParams.get("payTo") ?? "";\n    return withProtection(request, env, payTo, async () => {\n      const account = await ensureZeroFrictionMerchant(env.DB, payTo);\n      return json(feeBalanceBody(account));\n    });''',
)

replace_once(
    x402,
    '''    const account = await ensureZeroFrictionMerchant(env.DB, payTo);\n    const deposit = await verifyFinalizedBaseUsdcDeposit({\n      rpcUrl: env.BASE_RPC_URL,\n      transactionHash,\n      treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,\n      usdcContractAddress: BASE_USDC,\n    });\n    if (deposit.sender.toLowerCase() !== account.payTo)\n      throw new XGuardError(\n        "PAYMENT_CONFLICT",\n        "Fee payment must be sent from the same payTo address that uses XGuard",\n        409,\n      );\n    const updated = await recordZeroFrictionPayment(\n      env.DB,\n      account.payTo,\n      deposit,\n    );\n    return json({ credited: true, ...feeBalanceBody(updated, env) });''',
    '''    return withProtection(request, env, payTo, async () => {\n      const account = await ensureZeroFrictionMerchant(env.DB, payTo);\n      const deposit = await verifyFinalizedBaseUsdcDeposit({\n        rpcUrl: env.BASE_RPC_URL,\n        transactionHash,\n        treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,\n        usdcContractAddress: BASE_USDC,\n      });\n      const updated = await recordZeroFrictionPayment(\n        env.DB,\n        account.payTo,\n        deposit,\n      );\n      return json({ credited: true, ...feeBalanceBody(updated) });\n    });''',
)

replace_once(
    x402,
    '''function dueBlock(\n  account: ZeroFrictionAccount,\n  env: ZeroFrictionEnv,\n): Response | null {\n  const limit = postpaidLimitMicroUsd(env);''',
    '''function dueBlock(account: ZeroFrictionAccount): Response | null {\n  const limit = account.postpaidLimitMicroUsd;''',
)
replace_once(
    x402,
    '''      ...feeBalanceBody(account, env),''',
    '''      ...feeBalanceBody(account),''',
)

replace_once(
    x402,
    '''function feeBalanceBody(account: ZeroFrictionAccount, env: ZeroFrictionEnv) {\n  return {\n    payTo: account.payTo,\n    billingModel: "postpaid-after-finality",\n    feePerFinalizedSettlementMicroUsd: feeMicroUsd(env),\n    feePerFinalizedSettlementUsd: microUsdToUsd(feeMicroUsd(env)),\n    accruedMicroUsd: account.accruedMicroUsd,\n    paidMicroUsd: account.paidMicroUsd,\n    dueMicroUsd: account.dueMicroUsd,\n    creditMicroUsd: account.creditMicroUsd,\n    postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),''',
    '''function feeBalanceBody(account: ZeroFrictionAccount) {\n  return {\n    payTo: account.payTo,\n    billingModel: "capped-share-after-finality",\n    pricingVersion: account.pricingVersion,\n    feeBps: account.feeBps,\n    feePercent: `${account.feeBps / 100}%`,\n    feeCapMicroUsd: account.feeCapMicroUsd,\n    feeCapUsd: microUsdToUsd(account.feeCapMicroUsd),\n    accruedMicroUsd: account.accruedMicroUsd,\n    paidMicroUsd: account.paidMicroUsd,\n    dueMicroUsd: account.dueMicroUsd,\n    creditMicroUsd: account.creditMicroUsd,\n    postpaidLimitMicroUsd: account.postpaidLimitMicroUsd,''',
)

replace_once(
    x402,
    '''function feeHeaders(\n  account: ZeroFrictionAccount,\n  env: ZeroFrictionEnv,\n  state: string,\n): Record<string, string> {\n  return {\n    "X-XGuard-Auth": "none",\n    "X-XGuard-Billing": "postpaid-after-finality",\n    "X-XGuard-Fee-State": state,\n    "X-XGuard-Fee-USD": microUsdToUsd(feeMicroUsd(env)),\n    "X-XGuard-PayTo": account.payTo,\n  };\n}''',
    '''function feeHeaders(\n  account: ZeroFrictionAccount,\n  state: string,\n): Record<string, string> {\n  return {\n    "X-XGuard-Auth": "none-after-one-time-wallet-activation",\n    "X-XGuard-Billing": "capped-share-after-finality",\n    "X-XGuard-Fee-State": state,\n    "X-XGuard-Pricing-Version": account.pricingVersion,\n    "X-XGuard-Fee-Bps": String(account.feeBps),\n    "X-XGuard-Fee-Cap-USD": microUsdToUsd(account.feeCapMicroUsd),\n    "X-XGuard-PayTo": account.payTo,\n  };\n}''',
)

replace_once(
    x402,
    '''function publicErrorMessage(error: unknown): string {\n  if (error instanceof XGuardError) return error.message;\n  if (error instanceof Error && error.name === "AbortError")\n    return "Upstream facilitator timed out";\n  return "XGuard could not safely complete the request";\n}''',
    '''function publicErrorMessage(error: unknown): string {\n  if (error instanceof XGuardError) return error.message;\n  if (\n    error instanceof Error &&\n    error.message === "zero_friction_activation_required"\n  )\n    return "Activate this merchant payTo once at https://xguardgate.com/start. No account, API key, or prepayment is required.";\n  if (error instanceof Error && error.name === "AbortError")\n    return "Upstream facilitator timed out";\n  return "XGuard could not safely complete the request";\n}''',
)

replace_once(
    x402,
    '''): 400 | 401 | 402 | 409 | 415 | 429 | 500 | 503 {\n  if (error instanceof XGuardError) {''',
    '''): 400 | 401 | 402 | 403 | 409 | 415 | 429 | 500 | 503 {\n  if (\n    error instanceof Error &&\n    error.message === "zero_friction_activation_required"\n  )\n    return 403;\n  if (error instanceof XGuardError) {''',
)
replace_once(
    x402,
    '''    if ([400, 401, 402, 409, 415, 429, 500, 503].includes(status))\n      return status as 400 | 401 | 402 | 409 | 415 | 429 | 500 | 503;''',
    '''    if ([400, 401, 402, 403, 409, 415, 429, 500, 503].includes(status))\n      return status as 400 | 401 | 402 | 403 | 409 | 415 | 429 | 500 | 503;''',
)

# Make fee payments credit the selected activated account regardless of who pays
# the treasury transaction. A third party can only reduce a merchant's debt, and
# the globally unique transaction/log constraint prevents double-crediting.
billing = "apps/worker/src/zero-friction-billing.ts"
replace_once(
    billing,
    '''  if (deposit.sender.toLowerCase() !== account.payTo)\n    throw new Error("zero_friction_payment_sender_mismatch");\n  if (deposit.amountMicroUsd <= 0)''',
    '''  if (deposit.amountMicroUsd <= 0)''',
)

# Public manifest: retain compatibility constants as the maximum, but advertise
# the actual capped revenue-share contract and one-signature activation.
contract = "apps/worker/src/public-payment-contract.ts"
replace_once(
    contract,
    '''export const XGUARD_FINALIZED_FEE_USD = "0.0005";\nexport const XGUARD_FINALIZED_FEE_MICRO_USD = 500;''',
    '''export const XGUARD_FINALIZED_FEE_BPS = 50;\nexport const XGUARD_FINALIZED_FEE_USD = "0.001";\nexport const XGUARD_FINALIZED_FEE_MICRO_USD = 1000;''',
)
replace_once(
    contract,
    '''type PaymentEnv = {\n  XGUARD_TREASURY_USDC_ADDRESS?: string;\n  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;\n};''',
    '''type PaymentEnv = {\n  XGUARD_TREASURY_USDC_ADDRESS?: string;\n  XGUARD_PRICING_VERSION?: string;\n  XGUARD_FEE_BPS?: string;\n  XGUARD_FEE_CAP_MICRO_USD?: string;\n  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;\n};''',
)
replace_once(
    contract,
    '''      amountUsd: XGUARD_FINALIZED_FEE_USD,\n      amountMicroUsd: XGUARD_FINALIZED_FEE_MICRO_USD,\n      event: "finalized_successful_settlement",\n      billing: "zero_signup_postpaid",''',
    '''      pricingVersion:\n        env.XGUARD_PRICING_VERSION ?? "2026-08-zero-friction-v1",\n      model: "capped_revenue_share_after_finality",\n      feeBps: parseFeeBps(env.XGUARD_FEE_BPS),\n      feePercent: `${parseFeeBps(env.XGUARD_FEE_BPS) / 100}%`,\n      feeCapUsd: microUsdToUsd(parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD)),\n      feeCapMicroUsd: parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD),\n      event: "independently_finalized_successful_settlement",\n      billing: "postpaid_capped_revenue_share",''',
)
replace_once(
    contract,
    '''      signupRequired: false,\n      apiKeyRequired: false,\n      prepaymentRequired: false,\n      instruction: `Set the standard x402 facilitator URL to ${origin}`,\n      quickstart: `${origin}/quickstart`,''',
    '''      accountRequired: false,\n      emailRequired: false,\n      passwordRequired: false,\n      apiKeyRequired: false,\n      prepaymentRequired: false,\n      walletActivation: "one_signature",\n      activation: `${origin}/start`,\n      instruction: `Activate payTo once at ${origin}/start, then set the standard x402 facilitator URL to ${origin}`,\n      quickstart: `${origin}/start`,''',
)
replace_once(
    contract,
    '''function paymentPage(origin: string, env: PaymentEnv): string {\n  const limit = microUsdToUsd(parseLimit(env.XGUARD_POSTPAID_LIMIT_MICRO_USD));\n  return `<!doctype html>''',
    '''function paymentPage(origin: string, env: PaymentEnv): string {\n  const limit = microUsdToUsd(parseLimit(env.XGUARD_POSTPAID_LIMIT_MICRO_USD));\n  const feeBps = parseFeeBps(env.XGUARD_FEE_BPS);\n  const feeCap = microUsdToUsd(parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD));\n  return `<!doctype html>''',
)
replace_once(
    contract,
    '''<h1>XGuard payment door</h1><div class="price">$${XGUARD_FINALIZED_FEE_USD}</div><p>per independently finalized successful settlement. Verify, failures and idempotent retries add no fee.</p><div class="card"><h2>Start</h2><p><strong>No signup. No API key. No prepaid balance.</strong></p><pre>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</pre><p>That is the full x402 integration. Fees accrue postpaid by the merchant <code>payTo</code> address. Service only pauses when unpaid fees reach $${limit}.</p><a href="/quickstart">Open 30-second quickstart</a>''',
    '''<h1>XGuard payment door</h1><div class="price">${feeBps / 100}%</div><p>of each independently finalized successful settlement, capped at $${feeCap}. Verify, failures and idempotent retries add no fee.</p><div class="card"><h2>Start</h2><p><strong>No account. No email. No API key. No prepaid balance.</strong></p><p>Sign once with the merchant <code>payTo</code> wallet, then use:</p><pre>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</pre><p>Service only pauses when unpaid XGuard fees reach $${limit}.</p><a href="/start">Connect wallet & activate once</a>''',
)
replace_once(
    contract,
    '''function parseLimit(value: string | undefined): number {''',
    '''function parseFeeBps(value: string | undefined): number {\n  if (value === undefined || !/^[0-9]+$/.test(value))\n    return XGUARD_FINALIZED_FEE_BPS;\n  const parsed = Number(value);\n  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000\n    ? parsed\n    : XGUARD_FINALIZED_FEE_BPS;\n}\n\nfunction parseFeeCap(value: string | undefined): number {\n  if (value === undefined || !/^[0-9]+$/.test(value))\n    return XGUARD_FINALIZED_FEE_MICRO_USD;\n  const parsed = Number(value);\n  return Number.isSafeInteger(parsed) && parsed >= 0\n    ? parsed\n    : XGUARD_FINALIZED_FEE_MICRO_USD;\n}\n\nfunction parseLimit(value: string | undefined): number {''',
)

print("zero-friction source migration applied")
