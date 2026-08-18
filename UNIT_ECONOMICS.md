# Unit economics

All XGuard monetary values use exact integer micro-USD.

## Canonical x402 attempt economics

The fixed public x402 execution fee is:

```text
$0.030000 gross XGuard attempt fee
- attributable downstream provider cost actually incurred by XGuard
- variable infrastructure cost
= contribution per accepted authenticated economic attempt
```

The fee is earned once per `logicalPaymentKey` after authentication, supported-request parsing and successful prepaid-balance reservation, before downstream execution. A downstream verification or settlement failure does not refund an accepted attempt. Malformed or unauthenticated traffic and idempotent retries do not add another fixed attempt fee.

Contribution is not owner profit. Fixed infrastructure, taxes, reserve requirements, off-ramp costs, provider charges, customer liabilities, refunds unrelated to the non-refundable accepted-attempt rule, and other operating expenses remain separate.

## Current production route

The production provider manifest identifies the current downstream transaction submitter as **xpay**. Provider identity and live x402 capability must be read from the production manifest and `/supported`; historical PayAI assumptions are not the current production source of truth.

The checked-in mainnet configuration currently carries a downstream protocol-cost floor for xpay. A configured floor is not proof of the owner's total real-world variable cost. Runtime/observed provider cost, infrastructure usage, gas sponsorship terms, RPC cost and any account-specific commercial terms must be measured separately.

Because current attributable operating costs are not fully established by repository configuration alone, this document does **not** invent a net contribution or profit number.

## Other operation classes

The universal gateway also has separately configured execution classes for model, tool, source, analysis, security and payment-decision operations. Their prices and unit economics are independent from the fixed $0.03 x402 attempt fee and must not be mixed into x402 settlement accounting.

## What is and is not revenue

Merchant Base USDC top-ups are prepaid service balances and are customer liabilities when deposited. They are not XGuard revenue merely because funds arrive at the treasury.

For an accepted authenticated x402 economic attempt:

```text
USDC received as merchant top-up      != revenue when deposited
$0.030000 accepted attempt fee        = gross XGuard earned service revenue
idempotent retry of same payment key  = $0 additional attempt fee
downstream settlement truth           = separate transfer-finality evidence
contribution after real variable cost != final owner profit
```

Settlement truth can later be `FINALIZED`, `PENDING`, `PROVEN_FAILED` or `CONFLICT`. Those states determine the independently verified truth of the expected transfer; they do not retroactively change the already-earned accepted-attempt fee.

## Live-state reporting rule

The public mainnet endpoint is technically deployed and passes release checks only when the deployment workflow succeeds. Actual merchant balances, accepted attempts, earned revenue, provider costs and owner-distributable profit must be read from production accounting and external cost evidence before being reported as actual results.

## Break-even rule

Do not publish a break-even count until the attributable variable cost per accepted attempt and the relevant fixed monthly cost are both measured. When they are known:

```text
contribution per accepted attempt = 0.03 - variable cost per accepted attempt
break-even accepted attempts = fixed monthly cost / contribution per accepted attempt
```

If contribution is zero or negative, the route must not be represented as economically viable.
