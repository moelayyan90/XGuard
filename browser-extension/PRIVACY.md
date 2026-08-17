# XGuard Payment Decision — Privacy Policy

**Effective date:** August 17, 2026  
**Extension:** XGuard Payment Decision  
**Service:** https://xguardgate.com

XGuard Payment Decision is an optional buyer-side browser extension that can offer a pre-payment decision before a user continues through checkout. The extension is designed to minimize data collection and to keep checkout context on the device unless the user explicitly chooses **Use XGuard**.

## What the extension reads locally

To decide whether to show the optional XGuard prompt, the extension may inspect the current HTTPS page for checkout-related signals such as:

- the current page URL path and hostname;
- visible labels on payment or checkout buttons;
- form action URLs and script source URLs used to identify a payment provider;
- a visible payment amount and currency when one can be detected;
- provider hints such as Stripe, PayPal, Coinbase, Shopify, Adyen, or Checkout.com.

This detection happens locally in the browser. Merely detecting a checkout, showing the XGuard prompt, or choosing **Continue without XGuard** does not send that checkout context to XGuard.

## What is sent after explicit opt-in

Only after the user chooses **Use XGuard**, the extension sends a limited payment-intent record to `https://xguardgate.com`. Depending on what is available, that record can include:

- amount and currency;
- merchant hostname/origin;
- detected payment provider or rail;
- a local detection-confidence value;
- a request identifier generated for the XGuard decision.

XGuard returns a payment decision and evidence record. The extension does not execute the underlying purchase or payment.

For XGuard service-balance top-ups, the extension can also send the user-entered top-up amount, an XGuard-issued claim token, and a Base transaction hash so XGuard can verify and credit the top-up.

## Authentication data stored in the browser

When XGuard is first used, the extension creates a dedicated XGuard Buyer Pass. The pass and related local state are stored in `chrome.storage.local` and are sent only to `https://xguardgate.com` as authentication for XGuard API requests.

The extension does not place the Buyer Pass into merchant pages or checkout forms.

## Data the extension does not request

XGuard Payment Decision does not request or accept the user's:

- full payment-card number (PAN);
- CVV/CVC;
- card PIN;
- online-banking password;
- wallet private key;
- seed phrase or mnemonic.

The extension does not sell user data, use checkout data for advertising, or use it for cross-site behavioral profiling.

## Server-side use and retention

Information sent after **Use XGuard** is used to provide the requested payment decision, create transaction/evidence records, prevent duplicate billing, operate service accounting, and protect the service against abuse. XGuard may retain the resulting decision/evidence records as needed to provide transaction evidence and maintain service integrity. Raw page HTML and full page text are not sent as part of the browser payment-decision request.

XGuard does not currently advertise a fixed automatic deletion period for completed decision/evidence records. A Buyer Pass can be replaced or rotated without exposing it to merchant sites.

## Service providers and disclosure

The extension communicates with XGuard over HTTPS. XGuard's production service runs on infrastructure that may process network requests and operational security data necessary to deliver the service. XGuard does not disclose checkout context to advertisers or data brokers.

A Base transaction hash supplied for a service-balance top-up may be checked against public blockchain data to verify the transfer.

## User controls

Users can:

- choose **Continue without XGuard** and send no checkout context to XGuard;
- decline to use XGuard on a detected checkout;
- clear the extension's local storage or uninstall the extension to remove locally stored extension data;
- replace an invalid Buyer Pass through normal extension use.

Uninstalling the extension removes its local browser state but does not retroactively delete transaction/evidence records already created on the XGuard service.

## Security

XGuard API communication uses HTTPS. The extension limits XGuard API host access to `https://xguardgate.com` and does not load remote executable code.

## Changes to this policy

If the extension's data practices change, this policy and the store privacy disclosures must be updated before or with the corresponding extension release.

## Contact

For XGuard project and privacy questions, use the public repository at:

https://github.com/moelayyan90/XGuard

Do not post payment secrets, private keys, seed phrases, or other sensitive credentials in a public issue.
