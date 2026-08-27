# XGuard Connector for x402 Pay

A small WordPress 7.0+ connector plugin that makes **XGuard — Base mainnet** appear in Automattic's `x402-Pay` facilitator picker.

## What changes

The site owner keeps configuring the receiving wallet and price in x402 Pay. This connector changes only the facilitator backend:

```text
WordPress / x402 Pay
        ↓
https://api.xguardgate.com
        ↓
XGuard /verify + /settle routing
        ↓
compatible live x402 facilitator
```

XGuard does not rewrite the seller's signed `payTo` or amount.

## Requirements

- WordPress 7.0+
- PHP 8.1+
- Automattic `x402-Pay`
- Base mainnet receiving wallet configured in x402 Pay

## Install

Copy the `xguard-x402-connector` directory into `wp-content/plugins/` and activate **XGuard Connector for x402 Pay**.

Then open:

```text
Settings → x402 Pay → Facilitator
```

and select:

```text
XGuard — Base mainnet
```

The default mode needs no XGuard key and uses XGuard's current free allowance.

For sites with XGuard Usage Credits, set the key outside the database:

```php
define( 'XGUARD_LICENSE_KEY', 'your-license-key' );
```

or set the environment variable `XGUARD_LICENSE_KEY`.

## Network profile

- network: `base`
- asset: Base mainnet USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- decimals: `6`
- EIP-712 name/version: `USD Coin` / `2`
- facilitator: `https://api.xguardgate.com`

These values mirror x402 Pay's Base-mainnet Coinbase profile while substituting only the facilitator backend.

## Safety

The connector uses x402 Pay's own `X402FacilitatorClient`; it does not implement payment verification or settlement locally. x402 Pay constructs the PaymentRequirements/PaymentPayload and sends the standard calls to XGuard.

XGuard then applies its current routing/replay/reconciliation policy. An ambiguous settlement is not blindly replayed across downstream facilitators.
