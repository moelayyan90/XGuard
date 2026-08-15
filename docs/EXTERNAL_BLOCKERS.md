# External dependencies

This file separates **technical deployment** from optional or third-party dependencies that XGuard cannot truthfully manufacture: independent assurance, registry ownership, provider scaling, and bank/off-ramp authorization.

## Already completed technically

The following are no longer engineering blockers:

- Cloudflare account authorization and GitHub Actions deployment credentials;
- live Base Sepolia Worker and D1;
- live Base mainnet Worker and `xguard-mainnet` D1;
- Base mainnet native-USDC constraint and independent finality adapter;
- merchant bearer authentication and prepaid **XGuard service-credit** accounting;
- finalized Base USDC service-credit top-up verification;
- one-outbound settlement ownership, replay/duplicate protection, ambiguity/reconciliation state;
- mainnet post-deploy readiness checks;
- public GitHub repository, CI, CodeQL, protected `main`, Dependabot, secret scanning/push protection, and private vulnerability reporting.

XGuard's service-credit balance is used to pay XGuard's own per-successful-settlement service fee. It is not the payer-to-resource-server settlement amount. The settlement path separately verifies the expected payer, expected pay-to address, and expected settlement amount before XGuard recognizes its own service fee.

---

## Regulatory inquiry — withdrawn; not a launch dependency

A Jordan Securities Commission classification inquiry was sent on 2026-08-14 and updated on 2026-08-15 while the architecture was still being finalized.

On 2026-08-15 the owner withdrew that inquiry in writing and explicitly stated that no response or further action was requested. XGuard therefore does **not** wait for or depend on a reply to that inquiry for technical operation.

The operational model recorded by the repository is a software service charging a configurable XGuard fee for successful service events. XGuard does not treat the payer-to-resource-server settlement amount as an XGuard customer balance; settlement evidence records an expected payer, expected pay-to address, and expected amount, while XGuard's own merchant service-credit balance is separately used for XGuard fees.

This repository statement is an architectural and operational description, not a legal opinion or a claim of regulatory exemption. If the product later changes into custody, exchange, brokerage, or another materially different financial activity, that new model should be assessed on its own facts.

**Current operational status: no JSC response is awaited and no JSC response is a launch gate.**

---

## EXTERNAL_DEPENDENCY — PayAI scaling beyond the public/free production path

XGuard's live mainnet route currently uses PayAI compatibility and health checks. PayAI's public facilitator pricing page, checked 2026-08-15, advertises:

- 10,000 settlements/month free;
- Pay As You Go at `$0.001` per settlement;
- enterprise terms by agreement.

Official source: `https://facilitator.payai.network/`

PayAI also states that its public facilitator requires no API keys. Therefore, a paid PayAI account is **not a launch requirement** for XGuard within the currently published public/free limits and terms.

XGuard conservatively configures `1,000` micro-USD as the attributable downstream cost so unit economics do not assume the free allowance will remain available forever.

XGuard already supports `PAYAI_API_KEY_ID` and `PAYAI_API_KEY_SECRET` as encrypted deployment secrets for provider-authenticated scaling paths. If traffic exceeds the public/free limits, paid/provider-specific approval or another eligible route becomes an external scaling dependency.

**Can XGuard continue technically without a paid PayAI account?** Yes, within the provider's current public/free limits and terms.

---

## EXTERNAL_DEPENDENCY — Independent mainnet security review

First-party CI, CodeQL, dependency audit, adversarial replay/idempotency/concurrency tests, strict transport validation, Cloudflare runtime tests, and live smoke checks are implemented. They are useful evidence but not independent assurance.

A qualified outside reviewer would be required only before the project claims an **independent** production security review.

**Can XGuard continue technically without it?** Yes. **Can it truthfully claim independent mainnet assurance?** No.

---

## EXTERNAL_DEPENDENCY — Regulated bank/off-ramp and verified owner payout destination

Merchant service-credit top-ups can technically arrive at the configured Base USDC treasury address. These are payments toward XGuard's own service balance; they are separate from the payer-to-resource-server settlement amount. This is not the same as an automated bank payout and does not make the entire treasury balance owner profit.

A regulated off-ramp provider must independently approve the eligible account holder, destination, KYC/AML/sanctions status, transfer limits, fees, and production API authorization. Country availability alone is not approval.

The codebase contains fail-closed payout/reserve/accounting concepts, but no live connector has authority to transfer funds from an exchange account to a bank account.

**Can XGuard operate without it?** Yes. The crypto treasury can receive XGuard service-credit payments; automated bank owner payout remains unavailable.

---

## EXTERNAL_DEPENDENCY — npm package ownership and trusted publishing

Core, SDK, and CLI manifests/builds are prepared and dry-pack tested. The production gateway can be integrated today with the official x402 `HTTPFacilitatorClient`, so a public XGuard npm package is not required for the live HTTP service.

Publishing `xguard` / `@xguard/*` still requires authenticated registry ownership and trusted-publisher configuration. Package-name availability is not ownership and must not be assumed.

The repository also contains a release workflow that builds `.tgz` artifacts for the core, SDK, and CLI when a GitHub Release is published or the workflow is dispatched, so the packages are reproducibly buildable even before npm registry ownership exists.

**Can XGuard operate without npm publication?** Yes. Public `npm install @xguard/sdk` / `npx xguard` convenience distribution remains unavailable until registry ownership is established.

---

## EXTERNAL_DEPENDENCY — x402/Bazaar/ecosystem listing acceptance

The x402 Bazaar is facilitator-driven discovery: Bazaar-enabled resources can be cataloged through facilitators that support the extension, and PayAI currently advertises automatic Bazaar discovery for merchants using its facilitator. That mechanism concerns discoverable payable resources; it is not the same as being selected for the x402 documentation's curated list of production facilitators.

XGuard can expose its public endpoint and source code without a curated listing. It must not claim official x402 endorsement or selection unless the x402 maintainers independently accept such a listing.

**Can XGuard operate without a curated ecosystem listing?** Yes. Discovery/distribution is weaker until accepted.

---

## Owner-action status

As of 2026-08-15, **there is no ordinary engineering or deployment task waiting on the owner, and no response from the Jordan Securities Commission is awaited as an operating prerequisite**. Remaining items in this file are optional third-party assurance, scaling, distribution, or payout dependencies. They are not unfinished XGuard implementation work.
