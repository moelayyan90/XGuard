# Billing

## Primary x402 model

The recommended x402 seller path is **one-signature, postpaid billing**.

A merchant activates its `payTo` address once by signing the exact XGuard pricing terms. After that:

- `/verify` and `/settle` require no XGuard API key;
- no XGuard prepaid balance is required before the first payment;
- the buyer's x402 payment still goes to the original merchant `payTo` for the exact buyer-authorized amount;
- XGuard records a separate service receivable only after independent Base finality confirms success.

XGuard does not silently divert or skim the merchant's signed buyer payment.

## Current x402 pricing

| Event | XGuard fee |
| --- | ---: |
| `POST /verify` | $0 |
| malformed/rejected request | $0 |
| failed settlement | $0 |
| unresolved ambiguous settlement | $0 earned |
| idempotent retry | no additional fee |
| independently finalized successful settlement | 0.5%, capped at $0.001 |

The current default unpaid service-fee limit is $1.00. The exact terms accepted by each merchant are stored with the activated address.

## Activation state

Activation is not an XGuard account signup. It creates no password, email identity, API key, or custody relationship.

The activation challenge stores a hash of a short-lived nonce and the exact pricing terms. The merchant signs a message containing:

- XGuard domain;
- Base network;
- merchant `payTo`;
- pricing version;
- fee basis points;
- per-settlement cap;
- postpaid limit;
- issued/expiry timestamps;
- nonce;
- an explicit statement that the signature is not a token-transfer authorization.

The signature is verified against the merchant address before the postpaid account is activated. A consumed or expired challenge cannot be reused.

## Accounting state

```text
buyer payment signed to merchant payTo
        |
        v
XGuard /verify ----------------------------> no XGuard fee
        |
        v
XGuard /settle -> downstream submission
        |
        +-- failure ------------------------> no XGuard fee
        |
        +-- ambiguous ----------------------> no fee earned while unresolved
        |
        v
independent Base finality proves exact USDC transfer
        |
        v
calculate signed merchant fee terms
        |
        v
postpaid XGuard service receivable
```

The fee calculation uses the settlement amount that independent finality expects/proves and the merchant's stored signed terms:

```text
fee = min(floor(amount × fee_bps / 10,000), fee_cap)
```

Fee-event insertion is idempotent by logical payment key.

## Fee balance

```text
GET /v1/fees?payTo=0x...
```

The response reports the activated address's signed pricing version, fee basis points, fee cap, accrued amount, credited payments, outstanding due amount, credit, postpaid limit, and Base USDC treasury details.

## Crediting service-fee payments

```http
POST /v1/fees/claim
Content-Type: application/json

{
  "payTo": "0xMERCHANT",
  "transactionHash": "0xFINALIZED_BASE_TX"
}
```

XGuard independently verifies that the transaction contains a finalized native Base USDC transfer to the configured XGuard treasury before recording credit.

A transaction/log pair is globally unique in the billing database and cannot be credited twice. A third party may pay a merchant's XGuard debt because that action can only reduce the selected merchant's outstanding service receivable; it cannot create a charge or redirect a buyer payment.

## Postpaid limit

When `dueMicroUsd` reaches the signed `postpaidLimitMicroUsd`, protected x402 execution for that activated `payTo` pauses with HTTP `402` until enough service-fee credit is recorded.

This limit controls XGuard credit exposure; it is not a prerequisite deposit.

## Settlement ambiguity

Once outbound settlement submission begins, XGuard does not blindly retry the same authorization through another route. An uncertain outcome remains ambiguous until independent finality/recovery evidence resolves it.

No XGuard service fee is earned merely because a downstream request timed out or returned uncertain evidence.

## Revenue recognition invariants

- activation is not revenue;
- merchant fee payments are balance credits until matched to earned service receivables;
- verification is free on the zero-friction x402 path;
- failed settlement is free;
- duplicate retries cannot generate another fee;
- zero-friction settlement revenue is recognized only after independent finalized Base evidence;
- the stored signed merchant terms determine the fee, not a later silent configuration change;
- tiny proportional results may floor to zero rather than being forced to a minimum fee;
- usage and payment records are append-only/idempotent at their financial identity boundaries.

## Legacy universal-gateway billing

Authenticated merchant endpoints such as `/v1/register`, `/v1/balance`, `/v1/topups/*`, plus some model/tool/source/security/MCP execution surfaces, remain for backwards compatibility and retain their existing prepaid accounting model.

Those legacy routes are separate from the recommended x402 seller path. A new merchant using XGuard only as its x402 facilitator should not need them.
