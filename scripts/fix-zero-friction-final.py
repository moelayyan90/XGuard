from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


x402 = "apps/worker/src/zero-friction-x402.ts"

replace_once(x402, "const debtBlock = dueBlock(account);", "const debtBlock = dueBlock(account, env);")
replace_once(x402, "const debtBlock = dueBlock(account);", "const debtBlock = dueBlock(account, env);")
replace_once(x402, "return json(feeBalanceBody(account));", "return json(feeBalanceBody(account, env));")
replace_once(x402, "return json({ credited: true, ...feeBalanceBody(updated) });", "return json({ credited: true, ...feeBalanceBody(updated, env) });")
replace_once(
    x402,
    "function dueBlock(account: ZeroFrictionAccount): Response | null {\n  const limit = account.postpaidLimitMicroUsd;",
    "function dueBlock(\n  account: ZeroFrictionAccount,\n  env: ZeroFrictionEnv,\n): Response | null {\n  const limit = account.postpaidLimitMicroUsd;",
)
replace_once(x402, "...feeBalanceBody(account),", "...feeBalanceBody(account, env),")
replace_once(
    x402,
    "function feeBalanceBody(account: ZeroFrictionAccount) {",
    "function feeBalanceBody(\n  account: ZeroFrictionAccount,\n  env: ZeroFrictionEnv,\n) {",
)

replace_once(
    x402,
    '''        body.price = {\n          amount: microUsdToUsd(feeMicroUsd(env)),\n          currency: "USD",\n          event: "finalized_successful_settlement",\n          model: "zero_signup_postpaid",\n          verify: "free",\n          failedSettlement: "free",\n          retry: "no additional fee",\n        };\n        body.onboarding = {\n          signup: false,\n          apiKey: false,\n          prepay: false,\n          integration: "Set facilitator URL to https://xguardgate.com",\n        };''',
    '''        body.price = {\n          pricingVersion: pricingVersion(env),\n          model: "postpaid_capped_revenue_share",\n          feeBps: feeBps(env),\n          feePercent: `${feeBps(env) / 100}%`,\n          feeCapMicroUsd: feeCapMicroUsd(env),\n          feeCapUsd: microUsdToUsd(feeCapMicroUsd(env)),\n          currency: "USD",\n          event: "independently_finalized_successful_settlement",\n          verify: "free",\n          failedSettlement: "free",\n          retry: "no additional fee",\n        };\n        body.onboarding = {\n          account: false,\n          email: false,\n          apiKey: false,\n          prepay: false,\n          walletActivation: "one_signature",\n          activation: "https://xguardgate.com/start",\n          integration: "Activate payTo once, then set facilitator URL to https://xguardgate.com",\n        };''',
)
replace_once(
    x402,
    '''        body.billing = {\n          model: "zero_signup_postpaid",\n          feeMicroUsd: feeMicroUsd(env),\n          postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),\n        };''',
    '''        body.billing = {\n          pricingVersion: pricingVersion(env),\n          model: "postpaid_capped_revenue_share",\n          feeBps: feeBps(env),\n          feeCapMicroUsd: feeCapMicroUsd(env),\n          postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),\n          activation: "/start",\n        };''',
)
replace_once(
    x402,
    '''    const html = (await response.text())\n      .replaceAll("$0.04", `$${microUsdToUsd(feeMicroUsd(env))}`)\n      .replaceAll("prepaid", "postpaid")\n      .replaceAll("API key required", "No API key required");''',
    '''    const html = (await response.text())\n      .replaceAll("$0.04", `up to $${microUsdToUsd(feeCapMicroUsd(env))}`)\n      .replaceAll("$0.002", `up to $${microUsdToUsd(feeCapMicroUsd(env))}`)\n      .replaceAll("prepaid", "postpaid")\n      .replaceAll("API key required", "No API key required after one wallet signature");''',
)

replace_once(
    x402,
    '''function quickstartResponse(origin: string, env: ZeroFrictionEnv): Response {\n  const fee = microUsdToUsd(feeMicroUsd(env));\n  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XGuard Quickstart</title></head><body><main style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.55"><h1>XGuard: change one URL</h1><p>No account. No API key. No prepaid balance.</p><pre><code>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</code></pre><p>Verify is free. Failed settlements are free. A fee of $${fee} is accrued only after XGuard independently confirms a successful finalized settlement on Base.</p><p>Fee status: <code>GET ${origin}/v1/fees?payTo=0x...</code></p><p>When the postpaid limit is reached, send native Base USDC from the same <code>payTo</code> address to the treasury returned by that endpoint, then claim the transaction once.</p></main></body></html>`;''',
    '''function quickstartResponse(origin: string, env: ZeroFrictionEnv): Response {\n  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XGuard Quickstart</title></head><body><main style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.55"><h1>XGuard: activate once, then change one URL</h1><p>No account. No email. No API key. No prepaid balance.</p><p><a href="${origin}/start">Connect the merchant payTo wallet and sign once</a> to accept ${feeBps(env) / 100}% of independently finalized successful settlements, capped at $${microUsdToUsd(feeCapMicroUsd(env))} per settlement.</p><pre><code>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</code></pre><p>Verify, failed settlements and idempotent retries add no fee.</p><p>Fee status: <code>GET ${origin}/v1/fees?payTo=0x...</code></p></main></body></html>`;''',
)

replace_once(
    x402,
    '''  feeMicroUsd(env);\n  postpaidLimitMicroUsd(env);\n}\n\nfunction feeMicroUsd(env: ZeroFrictionEnv): number {\n  return boundedInteger(\n    env.XGUARD_FEE_MICRO_USD,\n    1,\n    1_000_000,\n    "XGUARD_FEE_MICRO_USD",\n  );\n}\n\nfunction postpaidLimitMicroUsd(env: ZeroFrictionEnv): number {''',
    '''  pricingVersion(env);\n  feeBps(env);\n  feeCapMicroUsd(env);\n  postpaidLimitMicroUsd(env);\n}\n\nfunction pricingVersion(env: ZeroFrictionEnv): string {\n  const value = env.XGUARD_PRICING_VERSION ?? "2026-08-zero-friction-v1";\n  if (!/^[a-z0-9._-]{1,64}$/i.test(value))\n    throw new Error("XGUARD_PRICING_VERSION_invalid");\n  return value;\n}\n\nfunction feeBps(env: ZeroFrictionEnv): number {\n  return boundedInteger(\n    env.XGUARD_FEE_BPS ?? "50",\n    0,\n    10_000,\n    "XGUARD_FEE_BPS",\n  );\n}\n\nfunction feeCapMicroUsd(env: ZeroFrictionEnv): number {\n  return boundedInteger(\n    env.XGUARD_FEE_CAP_MICRO_USD ?? "1000",\n    0,\n    1_000_000_000,\n    "XGUARD_FEE_CAP_MICRO_USD",\n  );\n}\n\nfunction postpaidLimitMicroUsd(env: ZeroFrictionEnv): number {''',
)

contract = "apps/worker/src/public-payment-contract.ts"
replace_once(contract, 'manifest: "xguard-payment-manifest-v2",', 'manifest: "xguard-payment-manifest-v3",')
replace_once(
    contract,
    '''      settlementResolve: `${origin}/v1/settlements/{logicalPaymentKey}/resolve`,\n    },''',
    '''      settlementResolve: `${origin}/v1/settlements/{logicalPaymentKey}/resolve`,\n      authAfterActivation: "none",\n    },''',
)
replace_once(contract, 'headers.set("X-XGuard-Pricing-Contract", "postpaid-finality-v2");', 'headers.set("X-XGuard-Pricing-Contract", "capped-share-finality-v3");')
replace_once(
    contract,
    '''      return "finalized_successful_settlement";''',
    '''      return "independently_finalized_successful_settlement";''',
)
replace_once(
    contract,
    '''    .replaceAll("$0.04", `$${XGUARD_FINALIZED_FEE_USD}`)\n    .replaceAll("$0.002", `$${XGUARD_FINALIZED_FEE_USD}`)\n    .replaceAll("0.04 USD", `${XGUARD_FINALIZED_FEE_USD} USD`)\n    .replaceAll("0.002 USD", `${XGUARD_FINALIZED_FEE_USD} USD`)''',
    '''    .replaceAll("$0.04", `up to $${XGUARD_FINALIZED_FEE_USD}`)\n    .replaceAll("$0.002", `up to $${XGUARD_FINALIZED_FEE_USD}`)\n    .replaceAll("0.04 USD", `up to ${XGUARD_FINALIZED_FEE_USD} USD`)\n    .replaceAll("0.002 USD", `up to ${XGUARD_FINALIZED_FEE_USD} USD`)''',
)
replace_once(contract, '.replaceAll("merchant_prepaid_service_balance", "zero_signup_postpaid")', '.replaceAll("merchant_prepaid_service_balance", "postpaid_capped_revenue_share")')
replace_once(contract, '      "zero_signup_postpaid",\n    );', '      "postpaid_capped_revenue_share",\n    );')
replace_once(contract, '        "X-XGuard-Pricing-Contract": "postpaid-finality-v2",', '        "X-XGuard-Pricing-Contract": "capped-share-finality-v3",')

print("final zero-friction consistency patch applied")
