# XGuard Pay All Browser Extension

This is the user-side floating XGuard layer. It does not require a merchant to install XGuard.

## Current behavior

- Runs as a Manifest V3 Chrome/Chromium extension.
- Detects likely checkout/payment pages from URL, payment controls, structured price metadata, and visible total elements.
- Shows a floating XGuard button on payment pages.
- Lets the user add the current payment to a cart that persists across websites.
- Stores the exact checkout URL, merchant host, title, amount, and currency locally in `chrome.storage.local`.
- Never reads card-number, CVV, password, or other credential input values.
- Provides a `Pay All` approval that starts one execution session and walks the user through the stored merchant checkouts in order.
- Tracks the active child payment and lets the user mark it paid and continue to the next checkout.

## Important execution boundary

The browser extension can create one XGuard approval UX and coordinate child payments without merchant integration. It cannot turn unrelated card-acquiring transactions at independent merchants into one native bank/card debit by itself.

A true one-debit / many-merchant execution mode requires an issuer, wallet, marketplace PSP, stablecoin batch router, or another authorized payment rail that accepts the XGuard batch authorization and performs the allocations.

The extension is therefore the universal user-facing layer; execution adapters can be added behind the same cart later without changing the UX.

## Load locally in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/browser-extension`.
5. Grant site access when Chrome asks. For universal detection, XGuard needs access to the checkout pages where the user wants the floating layer.

## Privacy model

The extension keeps the cart in browser-local storage and does not send payment-page contents to XGuard servers in this version. Exact checkout URLs may contain provider session identifiers, so they remain local and are used only to return the user to the saved checkout.
