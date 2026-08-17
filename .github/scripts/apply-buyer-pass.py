from pathlib import Path

path = Path("apps/worker/src/payment-decision.ts")
text = path.read_text()

old_import = 'import { authorizeMerchantScope } from "./mainnet-revenue-hardening.js";\n'
new_import = 'import { authenticateBuyerPass } from "./buyer-pass.js";\n' + old_import
if 'import { authenticateBuyerPass } from "./buyer-pass.js";' not in text:
    if old_import not in text:
        raise SystemExit("merchant auth import anchor missing")
    text = text.replace(old_import, new_import, 1)

old_auth = '''async function authorizePrincipal(
  request: Request,
  env: PaymentDecisionEnv,
): Promise<{ principalId: string; principalName: string }> {
  const access = await authorizeMerchantScope(request, env, "billing");
'''
new_auth = '''async function authorizePrincipal(
  request: Request,
  env: PaymentDecisionEnv,
): Promise<{ principalId: string; principalName: string }> {
  const buyerPass = await authenticateBuyerPass(request, env);
  if (buyerPass !== null)
    return {
      principalId: buyerPass.principalId,
      principalName: buyerPass.principalName,
    };

  const access = await authorizeMerchantScope(request, env, "billing");
'''
if 'const buyerPass = await authenticateBuyerPass(request, env);' not in text:
    if old_auth not in text:
        raise SystemExit("authorizePrincipal anchor missing")
    text = text.replace(old_auth, new_auth, 1)

old_offer = '''    feeMicroUsd,
    feeUsd: microUsdToUsd(feeMicroUsd),
    message: "Verify and document this payment with XGuard before paying?",
'''
new_offer = '''    feeMicroUsd,
    feeUsd: microUsdToUsd(feeMicroUsd),
    access: {
      buyerPassEndpoint: "/v1/buyer-pass",
      buyerPassTopUpEndpoint: "/v1/buyer-pass/topups/intents",
      merchantApiKeyAlsoAccepted: true,
    },
    message: "Verify and document this payment with XGuard before paying?",
'''
if 'buyerPassEndpoint: "/v1/buyer-pass"' not in text:
    if old_offer not in text:
        raise SystemExit("payment offer anchor missing")
    text = text.replace(old_offer, new_offer, 1)

old_discovery = '''      offer: `${origin}${OFFER_PATH}`,
      decision: `${origin}${DECISION_PATH}`,
'''
new_discovery = '''      offer: `${origin}${OFFER_PATH}`,
      buyerPass: `${origin}/v1/buyer-pass`,
      buyerPassTopUp: `${origin}/v1/buyer-pass/topups/intents`,
      decision: `${origin}${DECISION_PATH}`,
'''
if 'buyerPass: `${origin}/v1/buyer-pass`' not in text:
    if old_discovery not in text:
        raise SystemExit("discovery endpoint anchor missing")
    text = text.replace(old_discovery, new_discovery, 1)

path.write_text(text)
