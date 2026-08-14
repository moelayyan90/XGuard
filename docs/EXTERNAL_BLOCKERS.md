# External blockers

Only actions that require a regulated decision, identity/account authorization, third-party credential, or independent third-party acceptance are listed. Ordinary engineering work is not shifted to the owner.

Former blockers now completed: the Cloudflare account is authorized; the Worker and D1 database are deployed; funded Base Sepolia settlement has succeeded onchain; and the public GitHub repository has passing CI/CodeQL, protected `main`, Dependabot, secret scanning/push protection, and private vulnerability reporting. Those are no longer owner actions. Mainnet remains disabled.

---

**EXTERNAL_BLOCKER**  
**Name:** Jordan legal classification and authorization  
**Why automation cannot legally/technically complete it:** Jordan's [Virtual Asset Service Providers Licensing Regulation No. 94 of 2025](https://www.jsc.gov.jo/Uploads/Files/The%20Virtual%20Asset%20Service%20Providers%20Licensing%20Regulation%20for%20the%20year%202025-.pdf), issued under [Law No. 14 of 2025](https://www.jsc.gov.jo/page/ar/%D9%82%D8%A7%D9%86%D9%88%D9%86_%D8%AA%D9%86%D8%B8%D9%8A%D9%85_%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%85%D9%84_%D8%A8%D8%A7%D9%84%D8%A3%D8%B5%D9%88%D9%84_%D8%A7%D9%84%D8%A7%D9%81%D8%AA%D8%B1%D8%A7%D8%B6%D9%8A%D8%A9), is now in force. Article 4 includes transferring virtual assets from one address/account to another among regulated activities; Article 5 restricts carrying out virtual-asset activities for others without the applicable authorization and expressly addresses taking Jordan as a center of business; Article 10 separately regulates facilitating use of virtual assets for payment in Jordan. Those provisions mean that XGuard must not treat “non-custodial” by itself as legal clearance. Whether the final routing/forwarding, fee, merchant-funding, and payout model is a regulated activity, an outsourced technical service to a licensed provider, or otherwise outside a licensing category is a legal/regulatory determination; automation cannot supply a binding legal opinion, legal person, or regulator approval.  
**Current status:** A written classification inquiry was sent to the Jordan Securities Commission at its published `info@jsc.gov.jo` address on 2026-08-14. It describes the testnet-only, non-custodial architecture and asks specifically how Articles 4(4), 5, and 10 apply when XGuard routes a request but a separate third-party facilitator performs the blockchain submission, and whether a licensed-provider outsourcing model changes the classification. Mainnet stays disabled while the written response is pending.  
**Everything already completed:** Both shipped gateways reject mainnet in code; testnet has zero fees; custody/liability separation and regulated-provider assumptions are documented.  
**Exact smallest human action required:** Obtain a written Jordan-qualified classification of the final operating model and, only if required by that advice, form/authorize the legal person and obtain the applicable Jordan Securities Commission license or approval before a reviewed mainnet release. The regulator inquiry is already in flight; no duplicate inquiry is needed unless the Commission requests more information.  
**Whether XGuard can continue operating without it:** Public testnet diagnostics and non-billable settlement can operate; mainnet settlement, revenue collection, and payout cannot.

---

**EXTERNAL_BLOCKER**  
**Name:** Mainnet facilitator and merchant-funding authorization  
**Why automation cannot legally/technically complete it:** No authorized provider contract, business account, KYC decision, production credential, current tariff, or merchant funding authorization exists. These cannot be fabricated or accepted for the owner.  
**Everything already completed:** Normalized routing, capability polling, safe verification failover, settle-once ownership, prepaid accounting, negative-margin exclusion, and the independent-finality boundary are implemented. No environment variable can enable mainnet in the shipped gateways.  
**Exact smallest human action required:** After legal clearance, authorize an eligible facilitator/provider business account, accept its contract, complete any required KYC, approve the actual tariff, and permit its least-privilege production credential to be stored as an encrypted deployment secret. Each merchant must separately authorize its funding source.  
**Whether XGuard can continue operating without it:** Testnet and free diagnostics continue; mainnet settlement and billing cannot.

---

**EXTERNAL_BLOCKER**  
**Name:** Regulated off-ramp and verified payout destination  
**Why automation cannot legally/technically complete it:** A regulated provider must independently approve the eligible account holder, complete KYC/AML and sanctions checks, accept the business destination, and issue API authorization. Country availability alone is not approval.  
**Everything already completed:** Fail-closed payout policy, reserve, atomic gross reservation including provider fees, idempotent payout states, typed provider evidence, return accounting, and ambiguity stops are implemented; no destination or private credential appears in source.  
**Exact smallest human action required:** Complete truthful institutional onboarding with the selected provider and verify the business payout destination once; authorize storage of only the resulting scoped credential and destination reference in encrypted secrets.  
**Whether XGuard can continue operating without it:** Testnet can; owner payout stays disabled, and mainnet must not accumulate funds without an approved treasury/off-ramp plan.

---

**EXTERNAL_BLOCKER**  
**Name:** Independent mainnet security review  
**Why automation cannot legally/technically complete it:** The author cannot provide independent assurance over its own mainnet implementation, production provider adapter, finality adapter, and operational deployment. A qualified outside reviewer and their acceptance are separate parties.  
**Everything already completed:** Static checks, dependency audit, adversarial replay/idempotency/concurrency tests, Workers-runtime regressions, threat model, security review, and hard mainnet gates are present for the testnet release.  
**Exact smallest human action required:** After the remaining mainnet engineering and provider integration are complete, appoint and authorize a qualified independent reviewer; do not approve launch until all Critical/High findings are closed and the review covers deployed configuration as well as code. No paid engagement is assumed or initiated under the `$0` owner budget.  
**Whether XGuard can continue operating without it:** Testnet can; mainnet cannot be called safe or launched.

---

**EXTERNAL_BLOCKER**  
**Name:** npm package ownership and trusted publishing  
**Why automation cannot legally/technically complete it:** The npm CLI is not authenticated and no organization/scope authority or trusted-publisher binding exists. Registry search showed the candidate package names unregistered at the time checked, but availability is not ownership and a scope cannot be assumed to belong to the project merely because package names under it are unused.  
**Everything already completed:** The public GitHub repository and its security controls are active. Core, SDK, and CLI manifests/builds, repository metadata, package-local licenses, narrow file allowlists, dry-pack checks, examples, and artifact-only release workflow are prepared.  
**Exact smallest human action required:** Sign in to the intended npm owner account, claim or approve the final package names/scope, and bind npm trusted publishing to `moelayyan90/XGuard` and the reviewed release workflow. Only then may CI receive an explicit publishing job without a long-lived token.  
**Whether XGuard can continue operating without it:** Local packages and the source release candidate work; public `npx xguard@latest` is unavailable.

---

**EXTERNAL_BLOCKER**  
**Name:** x402/Bazaar/MCP ecosystem listing acceptance  
**Why automation cannot legally/technically complete it:** Listings require authenticated submission and independent ecosystem acceptance. The live URL is a testnet gateway, not a public paid resource, and the packages are not yet published.  
**Everything already completed:** Schema-complete Bazaar starter metadata, MCP example, pricing/security/docs, compatibility checker, and accurate listing boundaries are prepared.  
**Exact smallest human action required:** After GitHub/npm publication and the listing quality gate pass, authorize accurate official submissions; ecosystem maintainers make the acceptance decision.  
**Whether XGuard can continue operating without it:** Yes; only official-directory discovery is unavailable.
