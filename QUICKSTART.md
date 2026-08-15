# XGuard quickstart

XGuard has two live gateways:

- Base mainnet: `https://xguard-mainnet.maqamapp.workers.dev`
- Base Sepolia testnet: `https://xguard-testnet.maqamapp.workers.dev`

Mainnet charges `$0.002` only for a successful billable settlement after independent Base finality. Testnet is non-billable.

## 1. Verify mainnet readiness

```bash
curl https://xguard-mainnet.maqamapp.workers.dev/healthz
curl https://xguard-mainnet.maqamapp.workers.dev/readyz
curl https://xguard-mainnet.maqamapp.workers.dev/supported
curl https://xguard-mainnet.maqamapp.workers.dev/status
```

A ready mainnet gateway reports `mode: "mainnet"`, `mainnet: true`, a healthy facilitator, and an x402 v2 `exact` capability for `eip155:8453`.

## 2. Register a merchant

Registration creates a merchant identifier and a high-entropy API key. The API key is returned in the response and should be stored as a secret.

```bash
curl -sS -X POST https://xguard-mainnet.maqamapp.workers.dev/v1/register \
  -H 'Content-Type: application/json' \
  --data '{"name":"my-x402-service"}'
```

Save the returned key:

```bash
export XGUARD_URL=https://xguard-mainnet.maqamapp.workers.dev
export XGUARD_API_KEY='xg_live_...'
```

Do not commit `XGUARD_API_KEY`.

## 3. Create a prepaid top-up intent

Mainnet XGuard service fees are deducted from a merchant service balance. Request a one-time deposit intent:

```bash
curl -sS -X POST "$XGUARD_URL/v1/topups/intents" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"amountUsd":"1.00"}'
```

The response contains:

- `claimToken` — one-time secret used to claim the deposit;
- `treasuryAddress` — the configured Base USDC treasury destination;
- `exactDepositUsdc` — the exact USDC amount to send;
- `network` — `eip155:8453`;
- `asset` — native Base USDC.

Send **exactly** `exactDepositUsdc` native USDC on Base to `treasuryAddress`. Do not send another token, bridged `USDC.e`, or use another network.

Merchant top-ups are prepaid customer service balances. They are not XGuard earned revenue when deposited.

## 4. Claim the finalized deposit

After the Base transaction is finalized, claim it using the one-time token and transaction hash:

```bash
curl -sS -X POST "$XGUARD_URL/v1/topups/claim" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"claimToken":"YOUR_CLAIM_TOKEN","transactionHash":"0xYOUR_TX_HASH"}'
```

Check the credited service balance:

```bash
curl -sS "$XGUARD_URL/v1/balance" \
  -H "Authorization: Bearer $XGUARD_API_KEY"
```

## 5. Point an x402 v2 resource server at XGuard

Production does not require an XGuard npm package. Existing TypeScript projects that already use the official x402 HTTP client can configure it directly:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const createAuthHeaders = async () => {
  const headers = {
    Authorization: `Bearer ${process.env.XGUARD_API_KEY!}`,
  };
  return {
    verify: headers,
    settle: headers,
    supported: headers,
    bazaar: headers,
  };
};

const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.XGUARD_URL ?? "https://xguard-mainnet.maqamapp.workers.dev",
  createAuthHeaders,
});
```

The resource server continues using the official x402 v2 `FacilitatorClient` interface. XGuard currently accepts Base mainnet native USDC, `exact`, EIP-3009 authorization payments.

The workspace SDK implements the same flow:

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitatorClient = createXGuardFacilitator({
  url: process.env.XGUARD_URL!,
  apiKey: process.env.XGUARD_API_KEY,
});
```

The repository does not claim an npm release until publishing is activated, so the direct official-client configuration above is the zero-registry-dependency production path.

## 6. Understand the billing boundary

For each eligible mainnet settlement:

1. XGuard reserves `$0.002` from the merchant service balance.
2. It verifies and submits at most one settlement route.
3. A downstream success is not enough to earn the fee.
4. XGuard independently checks finalized Base USDC settlement state.
5. Only then does the reservation become earned XGuard revenue.
6. A definitive finality failure releases the reserved fee.
7. An ambiguous result is held and quarantined for reconciliation instead of being blindly resubmitted.

Duplicate retries of the same logical payment do not create another billable fee.

## Testnet path

The Base Sepolia gateway remains available for non-billable integration testing:

```bash
curl https://xguard-testnet.maqamapp.workers.dev/readyz
curl https://xguard-testnet.maqamapp.workers.dev/supported
```

The repository CLI can perform conservative testnet URL migration and rollback directly from GitHub:

```bash
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard doctor
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard init --gateway https://xguard-testnet.maqamapp.workers.dev
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard rollback
```

`xguard init` is intentionally URL-only and refuses provider-specific authentication. Use the authenticated client configuration above for mainnet.

See [API.md](docs/API.md) and [openapi.yaml](docs/openapi.yaml) for the HTTP contract.
