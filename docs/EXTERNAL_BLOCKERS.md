# External blockers

This file separates **technical deployment** from external decisions that XGuard cannot truthfully manufacture: regulatory classification, third-party account approval, independent assurance, registry ownership, and bank/off-ramp authorization.

## Already completed technically

The following are no longer engineering blockers:

- Cloudflare account authorization and GitHub Actions deployment credentials;
- live Base Sepolia Worker and D1;
- live Base mainnet Worker and `xguard-mainnet` D1;
- Base mainnet native-USDC constraint and independent finality adapter;
- merchant bearer authentication and prepaid service-balance accounting;
- finalized Base USDC top-up verification;
- one-outbound settlement ownership, replay/duplicate protection, ambiguity/reconciliation state;
- mainnet post-deploy readiness checks;
- public GitHub repository, CI, CodeQL, protected `main`, Dependabot, secret scanning/push protection, and private vulnerability reporting.

A technically live mainnet endpoint is **not** evidence that the legal/provider/security blockers below have been cleared.

---

## EXTERNAL_BLOCKER — Jordan regulatory classification / authorization

### Why this remains unresolved

Jordan's official Securities Commission publishes Law No. 14 of 2025, *Regulating the Dealing at Virtual Assets*, and Regulation No. 94 of 2025 for licensing virtual-asset service providers.

Official law page: `https://www.jsc.gov.jo/page/ar/قانون_تنظيم_التعامل_بالأصول_الافتراضية`

The law's Article 4 includes, among the listed virtual-asset activities, transferring virtual assets from one address/account to another. Article 5 restricts carrying out virtual-asset activities for others without the applicable licensed legal-person structure and separately addresses natural persons and taking Jordan as a center of business. The exact classification of XGuard's technical routing, prepaid service-balance, fee, and third-party facilitator model requires a Jordan-qualified legal/regulatory determination; the repository must not self-declare an exemption.

The Jordan Securities Commission announced that Regulation No. 94 of 2025 was published on 2025-12-16 and enters into force 30 days after publication:
`https://www.jsc.gov.jo/News/ar/12461`

### Inquiry status

A written classification inquiry was sent on 2026-08-14 to `info@jsc.gov.jo` and forwarded to `legal@jsc.gov.jo`. The connected mailbox was checked on 2026-08-15 and contained **no reply** from either address.

More importantly, the original inquiry described XGuard as operating only on public testnet with no live customer billing. The architecture changed afterward: a Base mainnet endpoint is now technically deployed with merchant registration, prepaid Base USDC service balances, a `$0.002` service fee, and mainnet settlement routing through a third-party facilitator. The original description is therefore not sufficient as a current description of the operating model.

### Smallest external action still required

Obtain a current written Jordan-qualified classification of the **final mainnet architecture**, including:

- whether XGuard's settlement routing through a separate facilitator constitutes an Article 4 activity for/for the benefit of others;
- whether accepting merchant USDC prepaid service balances changes the classification;
- whether the `$0.002` fee model is treated as a virtual-asset service, technical outsourcing, or another category;
- whether a licensed legal person, outsourcing arrangement with a licensed provider, Central Bank permission, or other approval is required;
- what geographic/customer restrictions apply if Jordan is the owner's center of business but customers are outside Jordan.

If the authority or qualified counsel says a license/entity/approval is required, that approval must be obtained before XGuard is represented as legally cleared.

### Current repository statement

**Technical mainnet: live. Legal clearance: unresolved.** The repository must not describe the live deployment as regulatory approval.

---

## EXTERNAL_BLOCKER — PayAI paid-tier account / production credentials at scale

XGuard's live mainnet route currently uses PayAI compatibility and health checks. PayAI's public facilitator pricing page, checked 2026-08-15, advertises:

- 10,000 settlements/month free;
- Pay As You Go at `$0.001` per settlement;
- enterprise terms by agreement.

Official source: `https://facilitator.payai.network/`

XGuard conservatively configures `1,000` micro-USD as the attributable downstream cost so unit economics do not assume the free allowance will remain available forever.

PayAI documentation describes merchant credits/API credentials for scaling beyond the default public usage path. XGuard already supports `PAYAI_API_KEY_ID` and `PAYAI_API_KEY_SECRET` as encrypted deployment secrets, but no repository statement should claim that the owner has an approved paid provider account or contract until PayAI independently grants it.

**Can XGuard continue technically without it?** Yes within whatever public/free provider limits and terms currently apply. Scaling beyond those limits requires the provider's own approval/credits/credentials or a different eligible route.

---

## EXTERNAL_BLOCKER — Independent mainnet security review

First-party CI, CodeQL, dependency audit, adversarial replay/idempotency/concurrency tests, strict transport validation, Cloudflare runtime tests, and live smoke checks are implemented. They are useful evidence but not independent assurance.

A qualified outside reviewer must independently review the deployed mainnet settlement path, billing/finality logic, configuration, secrets boundary, provider adapter, reconciliation, and operational failure modes before the project claims an independent production security review.

**Can XGuard continue technically without it?** Yes. **Can it truthfully claim independent mainnet assurance?** No.

---

## EXTERNAL_BLOCKER — Regulated bank/off-ramp and verified owner payout destination

Merchant top-ups can technically arrive at the configured Base USDC treasury address. This is not the same as an automated bank payout and does not make the entire treasury balance owner profit.

A regulated off-ramp provider must independently approve the eligible account holder, destination, KYC/AML/sanctions status, transfer limits, fees, and production API authorization. Country availability alone is not approval.

The codebase contains fail-closed payout/reserve/accounting concepts, but no live connector has authority to transfer funds from the user's exchange account to a bank account.

**Can XGuard operate without it?** The crypto treasury can receive funds; automated bank owner payout remains unavailable.

---

## EXTERNAL_BLOCKER — npm package ownership and trusted publishing

Core, SDK, and CLI manifests/builds are prepared and dry-pack tested. The production gateway can be integrated today with the official x402 `HTTPFacilitatorClient`, so a public XGuard npm package is not required for the live HTTP service.

Publishing `xguard` / `@xguard/*` still requires authenticated registry ownership and trusted-publisher configuration. Package-name availability is not ownership and must not be assumed.

**Can XGuard operate without it?** Yes. Public `npm install @xguard/sdk` / `npx xguard` convenience distribution remains unavailable until registry ownership is established.

---

## EXTERNAL_BLOCKER — x402/Bazaar/MCP ecosystem listing acceptance

Official ecosystem listings require authenticated submission and independent acceptance by their maintainers. XGuard can expose a public endpoint and source code without such acceptance, but cannot claim an official listing until the relevant ecosystem approves it.

**Can XGuard operate without it?** Yes. Discovery/distribution is weaker until accepted.
