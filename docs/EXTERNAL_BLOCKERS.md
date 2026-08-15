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

Jordan's official Securities Commission publishes Law No. 14 of 2025, _Regulating the Dealing at Virtual Assets_, and Regulation No. 94 of 2025 for licensing virtual-asset service providers.

Official law page: `https://www.jsc.gov.jo/page/ar/قانون_تنظيم_التعامل_بالأصول_الافتراضية`

The law's Article 4 includes, among the listed virtual-asset activities, transferring virtual assets from one address/account to another. Article 5 restricts carrying out virtual-asset activities for others without the applicable licensed legal-person structure and separately addresses natural persons and taking Jordan as a center of business. The exact classification of XGuard's technical routing, prepaid service-balance, fee, and third-party facilitator model requires a Jordan-qualified legal/regulatory determination; the repository must not self-declare an exemption.

The Jordan Securities Commission announced that Regulation No. 94 of 2025 was published on 2025-12-16 and enters into force 30 days after publication:
`https://www.jsc.gov.jo/News/ar/12461`

### Inquiry status

A written classification inquiry was first sent on 2026-08-14 to `info@jsc.gov.jo` and forwarded to `legal@jsc.gov.jo`.

After the architecture changed, an updated classification request describing the **current final mainnet architecture** was sent on 2026-08-15 to `legal@jsc.gov.jo`, with `info@jsc.gov.jo` copied. It explicitly disclosed the technically deployed Base mainnet endpoint, merchant authentication, native Base USDC prepaid service balances, the `$0.002` service fee, third-party facilitator routing, delayed revenue recognition after independent finality, and the distinction between technical deployment and regulatory authorization.

The updated request asks the authority to classify the routing model and prepaid service balance, identify any required licence/legal-person/outsourcing/approval structure, clarify geographic scope when the operator is based in Jordan, and identify the competent authority if another regulator is responsible.

**No owner action is currently pending on this inquiry. The external dependency is the authority's written response.**

### Current repository statement

**Technical mainnet: live. Legal clearance: unresolved.** The repository must not describe the live deployment as regulatory approval.

---

## EXTERNAL_BLOCKER — PayAI scaling beyond the public/free production path

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

## EXTERNAL_BLOCKER — Independent mainnet security review

First-party CI, CodeQL, dependency audit, adversarial replay/idempotency/concurrency tests, strict transport validation, Cloudflare runtime tests, and live smoke checks are implemented. They are useful evidence but not independent assurance.

A qualified outside reviewer must independently review the deployed mainnet settlement path, billing/finality logic, configuration, secrets boundary, provider adapter, reconciliation, and operational failure modes before the project claims an independent production security review.

**Can XGuard continue technically without it?** Yes. **Can it truthfully claim independent mainnet assurance?** No.

---

## EXTERNAL_BLOCKER — Regulated bank/off-ramp and verified owner payout destination

Merchant top-ups can technically arrive at the configured Base USDC treasury address. This is not the same as an automated bank payout and does not make the entire treasury balance owner profit.

A regulated off-ramp provider must independently approve the eligible account holder, destination, KYC/AML/sanctions status, transfer limits, fees, and production API authorization. Country availability alone is not approval.

The codebase contains fail-closed payout/reserve/accounting concepts, but no live connector has authority to transfer funds from an exchange account to a bank account.

**Can XGuard operate without it?** The crypto treasury can receive funds; automated bank owner payout remains unavailable.

---

## EXTERNAL_BLOCKER — npm package ownership and trusted publishing

Core, SDK, and CLI manifests/builds are prepared and dry-pack tested. The production gateway can be integrated today with the official x402 `HTTPFacilitatorClient`, so a public XGuard npm package is not required for the live HTTP service.

Publishing `xguard` / `@xguard/*` still requires authenticated registry ownership and trusted-publisher configuration. Package-name availability is not ownership and must not be assumed.

The repository also contains a release workflow that builds `.tgz` artifacts for the core, SDK, and CLI when a GitHub Release is published or the workflow is dispatched, so the packages are reproducibly buildable even before npm registry ownership exists.

**Can XGuard operate without npm publication?** Yes. Public `npm install @xguard/sdk` / `npx xguard` convenience distribution remains unavailable until registry ownership is established.

---

## EXTERNAL_BLOCKER — x402/Bazaar/ecosystem listing acceptance

The x402 Bazaar is facilitator-driven discovery: Bazaar-enabled resources can be cataloged through facilitators that support the extension, and PayAI currently advertises automatic Bazaar discovery for merchants using its facilitator. That mechanism concerns discoverable payable resources; it is not the same as being selected for the x402 documentation's curated list of production facilitators.

XGuard can expose its public endpoint and source code without a curated listing. It must not claim official x402 endorsement or selection unless the x402 maintainers independently accept such a listing.

**Can XGuard operate without a curated ecosystem listing?** Yes. Discovery/distribution is weaker until accepted.

---

## Owner-action status

As of 2026-08-15, **there is no ordinary engineering or deployment task waiting on the owner**. Remaining items in this file are external approvals, independent third-party assurance, optional distribution ownership, or payout-provider authorization. They must not be misrepresented as completed, but they are not unfinished XGuard implementation work.
