# XGuard Payment Layer — Privacy Policy

**Effective date:** August 18, 2026  
**Extension:** XGuard Payment Layer  
**Service:** https://xguardgate.com

XGuard is a buyer-side floating payment layer. It can detect likely payment, billing, checkout, and transfer surfaces on HTTPS pages; let the user defer a payment for later; remember payees and payment names; coordinate one-payment or multi-payment sessions; create local split-payment plans; and optionally request an XGuard payment-verification result.

## Local payment-surface detection

The extension may inspect the current HTTPS page locally for limited payment-related signals such as:

- page hostname, path, and current payment URL;
- visible payment, checkout, transfer, beneficiary, or recipient labels;
- visible amount/total and currency;
- payment-provider hints such as Stripe, PayPal, Coinbase, Shopify, Adyen, or Checkout.com.

Detection happens in the browser. Merely showing the floating XGuard layer does not transmit raw page HTML, full page text, card fields, or passwords to XGuard.

## Local payment memory

When the user chooses **ترحيل لغايات الدفع / Defer for payment**, XGuard can store in `chrome.storage.local`:

- the exact payment URL needed to return to that payment;
- the user-visible name of the payment;
- the saved payee/recipient name;
- merchant hostname/origin and detected provider;
- amount and currency;
- local pending-payment, session, split-group, and timestamp information.

XGuard also keeps a local payee memory containing the payee name, last payment name, last amount/currency, last usable payment URL, payment count, and last-paid time. This lets the user reuse a known recipient instead of registering it again.

Completed-payment history is stored locally so XGuard can show the user which named payments were completed and to whom.

These local pending payments, payee records, and history records are not uploaded to XGuard servers by the browser-memory feature.

## Single, Pay All, and split sessions

The browser layer can coordinate:

- one saved payment;
- several deferred payments in a Pay All sequence;
- a split plan that creates child payments for two or more saved payees.

The current browser-only implementation does not claim to convert unrelated card transactions into one native bank debit. Each underlying merchant or transfer destination remains subject to its own payment controls and any bank, wallet, 3-D Secure, or provider authentication. A true one-debit/many-recipient settlement mode requires an authorized payment rail that supports that capability.

## Optional XGuard server-side verification

Only after the user explicitly chooses the XGuard verification action does the extension send a limited payment-intent record to `https://xguardgate.com`. Depending on what is available, that record can include:

- amount and currency;
- payee name or merchant origin;
- detected payment provider or rail;
- local detection-confidence metadata;
- an idempotency request identifier.

XGuard returns a payment decision/evidence result. The extension does not send the user's card number or banking credentials to XGuard.

Users can use local payment memory and **Continue without XGuard** verification; doing so does not send a payment-decision request to the XGuard service.

## Authentication data stored in the browser

When the optional server-side verification service is first used, the extension can create a dedicated XGuard Buyer Pass. The pass and related state are stored in `chrome.storage.local` and sent only to `https://xguardgate.com` for XGuard API requests. The Buyer Pass is not inserted into merchant pages or payment forms.

## Data the extension does not request

XGuard does not request or accept the user's:

- full payment-card number (card number / PAN);
- CVV/CVC;
- card PIN;
- online-banking password;
- wallet private key;
- seed phrase or mnemonic.

The extension does not sell user data, use payment-memory data for advertising, or use it for cross-site behavioral profiling.

## User controls

Users can remove individual deferred payments, stop a payment session, clear browser-local XGuard data, or uninstall the extension. Uninstalling removes local extension state but does not retroactively delete server-side verification/evidence records that the user explicitly requested earlier.

## Security

XGuard API communication uses HTTPS. The extension does not load remote executable code. Sensitive payment credential fields are not collected or persisted by the extension.

## Changes to this policy

If the extension's data practices change, this policy and the browser-store disclosures must be updated before or with the corresponding release.

## Contact

Project and privacy questions: https://github.com/moelayyan90/XGuard

Do not post payment secrets, private keys, seed phrases, card credentials, or banking passwords in a public issue.
