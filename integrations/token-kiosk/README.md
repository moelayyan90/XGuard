# XGuard / Token Kiosk: limited evaluation (not production)

Partner: GAIB / Token Kiosk. Confirmed by Hung Cheng on 2026-11-23.
Authoritative docs: https://token-kiosk.gaib.ai/docs/authentication and
https://token-kiosk.gaib.ai/docs/api/api-keys

**Status:** implementation and local contract tests only. No wallet signature, promo redemption,
issued API key, paid inference, commercial partnership or deployment has been verified.
This script does not alter the XGuard production payment rail.

## Automated steps

1. Assemble a fresh EIP-4361 Sign-In with Ethereum message bound to
   api-token-kiosk.gaib.ai, the key-management URI and Base chain ID 8453.
2. Sign locally with a **dedicated evaluation wallet**. Never upload the private key to
   GitHub, a chat, a cloud log, or an outside party. There is no chain transaction.
3. Make **one** request to POST /v1/auth/keys using the separately supplied promo
   redemption code, a $5 key budget, a gemini-2.5-flash model restriction and 7-day expiry.
   The one-time code is not checked into this repository.
4. Save the one-time issued API key to token-kiosk-private.json with permissions 0600.
   A pre-request pending marker prevents accidental replay when the outcome is ambiguous.
5. Run one capped 16-output-token inference and report status, latency and token usage,
   without logging secrets or the generated reply. No automatic top-ups.
6. Optional, only with an authorized XGUARD_EGRESS_OPERATOR_KEY: register Token Kiosk
   as a custom Bearer-token provider in XGuard Secretless Egress. Scope: exact host
   api-token-kiosk.gaib.ai, prefix /v1/chat/completions, POST only. No production
   customer routing is enabled by default.

## Run from XGuard repository root

Install existing dependencies:

    npm ci --prefix apps/relay

Set environment variables securely on the execution machine (never commit them):

    TOKEN_KIOSK_WALLET_PRIVATE_KEY=<dedicated-wallet-private-key>
    TOKEN_KIOSK_REDEEM_CODE=<one-time-promo-code>

The local output file is token-kiosk-private.json (gitignored). Alternatively
set TOKEN_KIOSK_PRIVATE_FILE to a private absolute path outside the repository.

    node apps/relay/scripts/token-kiosk-evaluate.mjs
    node --test apps/relay/test/token-kiosk-evaluation.test.mjs

Setting XGUARD_EGRESS_OPERATOR_KEY optionally registers the key in the vault
after successful inference; leave it unset for the initial evaluation.

## Safety and constraints

- Requires an authorized wallet signature. No authorized wallet signer is available
  to the repository changes, so live redemption has not occurred.
- No credits or money are transferred to XGuard or its owner as revenue.
- Never retry ambiguous one-time redemption. If private state says pending, reconcile
  with Token Kiosk before retrying; do not simply delete the marker.
- Check the partner's terms and resale rights before commercial routing.
- Upstream Token Kiosk usage charges are separate from XGuard gateway credits.
- The integration is incomplete until a real API key, one inference response and,
  if authorized, the restricted vault registration are independently verified.
