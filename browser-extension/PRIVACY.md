# XGuard Pay All — Privacy Policy

**Effective date:** August 18, 2026  
**Extension:** XGuard Pay All  
**Service:** https://xguardgate.com

XGuard Pay All is a buyer-side browser layer that detects likely checkout pages, lets the user save several payments from different websites into one local cart, coordinates a Pay All session, and can optionally request an XGuard payment-decision result.

## Local checkout detection

The extension may inspect the current HTTPS page locally for checkout-related signals such as:

- page hostname, path, and current checkout URL;
- visible checkout/payment button labels;
- visible total/amount and currency;
- payment-provider hints such as Stripe, PayPal, Coinbase, Shopify, Adyen, or Checkout.com.

This detection happens in the browser. XGuard does not transmit raw page HTML, full page text, card fields, or passwords merely because the floating layer appears.

## Pay All cart data

When the user chooses **Add this payment** / **احجز هذه الدفعة**, the extension stores the following in `chrome.storage.local`:

- exact checkout URL so the browser can return to that payment;
- merchant hostname and page title;
- amount and currency;
- detected provider label;
- local cart/session identifiers and timestamps.

Checkout URLs can contain provider session identifiers. They remain in browser-local storage in this version and are used only to return the user to saved checkout pages. They are not sent to XGuard servers as part of the Pay All cart.

The Pay All session records which child payment the user is currently completing and the local outcome the user selected before moving to the next saved checkout.

## Optional XGuard payment decision

Only after the user explicitly selects **Verify this payment with XGuard** does the extension send a limited payment-intent record to `https://xguardgate.com`. Depending on what is available, that record can include:

- amount and currency;
- merchant hostname/origin;
- detected payment provider or rail;
- a local detection-confidence value;
- a request identifier generated for the XGuard decision.

XGuard returns a payment decision and evidence record. The extension does not send the user's card number or banking credentials to XGuard.

Users can simply use the Pay All cart or **Continue without XGuard** verification; doing so does not send a payment-decision request to the XGuard service.

## Authentication data stored in the browser

When the optional server-side XGuard decision service is first used, the extension can create a dedicated XGuard Buyer Pass. The pass and related state are stored in `chrome.storage.local` and are sent only to `https://xguardgate.com` for XGuard API requests.

The Buyer Pass is not inserted into merchant pages or checkout forms.

## Data the extension does not request

XGuard Pay All does not request or accept the user's:

- full payment-card number (card number / PAN);
- CVV/CVC;
- card PIN;
- online-banking password;
- wallet private key;
- seed phrase or mnemonic.

The extension does not sell user data, use checkout data for advertising, or use it for cross-site behavioral profiling.

## Payment execution boundary

The browser extension does not claim to turn unrelated merchant card transactions into one native bank debit by itself. In the current browser-only mode, one XGuard Pay All approval starts a coordinated sequence of the original merchant checkout pages. The user still completes the underlying merchant payment controls and any bank, wallet, or 3-D Secure authentication required by those payment providers.

A future one-debit/many-recipient mode would require an authorized issuer, wallet, marketplace PSP, stablecoin batch router, or another payment rail that supports batch authorization.

## Server-side use and retention

Information sent after an explicit XGuard verification request is used to provide the requested payment decision, create evidence records, prevent duplicate billing, operate service accounting, and protect the service against abuse. Pay All cart URLs and cart contents are not uploaded by the current browser-cart implementation.

## Service providers and disclosure

The extension communicates with XGuard over HTTPS only for features the user explicitly invokes that require the XGuard service. XGuard does not disclose checkout context to advertisers or data brokers.

## User controls

Users can:

- remove individual saved payments from the Pay All cart;
- clear the entire local Pay All cart;
- stop an active Pay All session;
- use the cart without requesting an XGuard server-side payment decision;
- choose **Continue without XGuard** verification;
- clear extension local storage or uninstall the extension.

Uninstalling the extension removes its local browser state but does not retroactively delete server-side decision/evidence records that were explicitly requested earlier.

## Security

XGuard API communication uses HTTPS. The extension does not load remote executable code. Sensitive payment credential fields are not collected or persisted by the extension.

## Changes to this policy

If the extension's data practices change, this policy and the browser-store disclosures must be updated before or with the corresponding release.

## Contact

Project and privacy questions: https://github.com/moelayyan90/XGuard

Do not post payment secrets, private keys, seed phrases, card credentials, or banking passwords in a public issue.
