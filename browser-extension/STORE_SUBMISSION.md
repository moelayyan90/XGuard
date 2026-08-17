# Browser Store Submission — XGuard Payment Decision 0.1.0

This file contains the exact submission copy and privacy disclosures for the first public Chrome Web Store and Microsoft Edge Add-ons release.

## Package

- Product name: **XGuard Payment Decision**
- Version: **0.1.0**
- Manifest: **Manifest V3**
- Homepage: `https://xguardgate.com/`
- Privacy policy: `https://github.com/moelayyan90/XGuard/blob/main/browser-extension/PRIVACY.md`
- Support/project URL: `https://github.com/moelayyan90/XGuard`
- Runtime package artifact: `xguard-payment-decision-0.1.0.zip`

## Single purpose

> Offer an optional buyer-side payment verification decision before checkout and return transaction evidence after the user explicitly opts in.

## Short description

> Optional buyer-side payment verification and transaction evidence before checkout. Showing or skipping XGuard is free.

## Full description

XGuard Payment Decision adds an optional buyer-side verification step before checkout. When a checkout-like HTTPS page is detected, the extension can show a small XGuard prompt. Detection happens locally in the browser.

No checkout context is sent to XGuard merely because the prompt appears. If the user chooses **Continue without XGuard**, no checkout context is sent to XGuard and no XGuard decision fee is earned.

If the user chooses **Use XGuard**, the extension sends a limited payment-intent record — such as the declared amount, currency, merchant hostname/origin, and detected provider — to `xguardgate.com`. XGuard returns an ALLOW, REVIEW, or BLOCK decision together with an evidence record. XGuard does not execute the merchant payment.

The extension uses a dedicated Buyer Pass stored locally in the browser. It does not need a merchant API key and does not put its Buyer Pass into merchant pages. XGuard Payment Decision does not request a card number, CVV/CVC, PIN, banking password, wallet private key, seed phrase, or mnemonic.

A prepaid XGuard service balance is used only for completed XGuard decision results. Showing the offer and skipping it are free.

## Suggested category

**Shopping** — payment/checkout utility.

## Permission justifications

### `storage`

Required to store the browser's XGuard Buyer Pass, Buyer Pass identifier, and local service-balance/top-up state. This information is kept in extension-local storage and is not written into merchant pages.

### `https://xguardgate.com/*`

Required for the service worker and extension options page to create/use a Buyer Pass, request a payment decision, read the XGuard service balance, and verify XGuard balance top-ups.

### Checkout-page access: `https://*/*`

Required because checkout pages can exist on any HTTPS merchant domain. The content script performs local checkout detection and shows the optional XGuard offer. Page context is not transmitted simply because a page is scanned or the offer is displayed. A limited payment-intent record is transmitted only after the user explicitly selects **Use XGuard**.

The extension intentionally does **not** run on `http://*/*`.

## Remote code

**No.** The extension package contains its executable JavaScript. It does not download or execute remote JavaScript, WebAssembly, or other remote code.

## Data disclosure

Disclose the following because they can be transmitted after explicit user opt-in:

- **Website content** — limited checkout facts derived from the current page.
- **Web history / current site information** — merchant hostname/origin associated with the opted-in checkout.
- **Financial and payment information** — declared transaction amount/currency and, only for an XGuard service-balance top-up, a public Base transaction hash.

Do **not** claim that the extension collects card numbers, CVV/CVC, PINs, banking passwords, wallet private keys, seed phrases, or mnemonics.

### Data use

- App functionality: **Yes**
- Fraud prevention / security / payment-safety decision: **Yes**
- Analytics: **No**
- Advertising: **No**
- Personalized advertising: **No**
- Sale of user data: **No**
- Cross-site behavioral profiling: **No**

Complete the Chrome Web Store Limited Use certification consistently with these disclosures.

## Chrome Web Store assets

- Store icon: `store-assets/icon128.png` — 128×128
- Required screenshot: `store-assets/screenshot-1280x800.png` — 1280×800
- Small promotional tile: `store-assets/small-promo-440x280.png` — 440×280
- Optional marquee tile: `store-assets/large-promo-1400x560.png` — 1400×560

## Microsoft Edge Add-ons assets

- Extension logo: `store-assets/edge-logo-300.png` — 300×300
- Small promotional tile: `store-assets/small-promo-440x280.png` — 440×280
- Large promotional tile: `store-assets/large-promo-1400x560.png` — 1400×560
- Screenshot: `store-assets/screenshot-1280x800.png` — 1280×800

## Edge listing notes

Use the full description above. It exceeds the Edge 250-character minimum and accurately states the extension's functionality and limitations.

Privacy answer: **Yes, the extension accesses/transmits privacy-relevant information after explicit opt-in.**

Remote code answer: **No.**

## Submission boundary

Store dashboards require the publisher's own developer-account enrollment and authenticated submission. The release artifact deliberately contains no store credentials, OAuth refresh tokens, or publisher secrets.
