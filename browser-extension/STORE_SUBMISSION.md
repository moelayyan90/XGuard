# Browser Store Submission — XGuard Payment Layer 0.2.0

## Package

- Product name: **XGuard Payment Layer**
- Version: **0.2.0**
- Manifest: **Manifest V3**
- Homepage: `https://xguardgate.com/`
- Privacy policy: `https://github.com/moelayyan90/XGuard/blob/main/browser-extension/PRIVACY.md`
- Support/project URL: `https://github.com/moelayyan90/XGuard`

## Single purpose

> Provide a buyer-side floating payment layer on HTTPS payment surfaces so users can name and defer payments, remember payees, reuse previous recipients, coordinate one or many payments, create split-payment plans, and optionally verify a payment with XGuard without merchant integration.

## Short description

> A floating payment memory layer for single payments, deferred bills, Pay All, saved payees, history, and payment splitting.

## Full description

XGuard Payment Layer runs on the buyer side. When the user reaches a likely checkout, billing, payment, beneficiary, or transfer page, XGuard detects limited payment context locally and shows a small floating XGuard control.

The user can name a payment and its recipient, choose **ترحيل لغايات الدفع / Defer for payment**, and continue browsing. XGuard remembers the payee, payment label, last amount/currency, and the last payment destination locally so the recipient can be reused without registering it again.

The same layer supports:

- **دفع هذه فقط / Pay this only** for a single tracked payment;
- **دفع كل الفواتير / Pay all bills** for a local multi-payment session;
- **تقسيم الفواتير / Split bills** to create child payments for multiple saved payees;
- local completed-payment history;
- optional XGuard payment verification.

The payment queue, saved payees, and payment history are stored in `chrome.storage.local`. Merchant participation is not required for the floating interface.

The browser-only layer does not pretend that unrelated merchant card transactions become one native bank debit. Underlying payments remain subject to each merchant, bank, wallet, or payment provider. A true one-debit/many-recipient settlement mode requires an authorized rail that supports batch authorization and distribution.

XGuard does not request the user's full card number, CVV/CVC, PIN, online-banking password, wallet private key, seed phrase, or mnemonic.

## Suggested category

**Shopping** — payment/checkout utility.

## Permission justifications

### `storage`

Required to store the local deferred-payment queue, active payment session, saved payee memory, completed-payment history, and the optional XGuard Buyer Pass used only for explicit XGuard server requests.

### `https://xguardgate.com/*`

Required only for explicit XGuard service features such as payment verification, Buyer Pass creation, and service-balance operations.

### Payment-page access: `https://*/*`

Payment and transfer pages can exist on any HTTPS domain. The content script performs local payment-surface detection and renders the floating XGuard interface. Merchant pages do not need to integrate XGuard.

The extension intentionally does **not** run on `http://*/*`.

## Remote code

**No.** The extension package contains its executable JavaScript. It does not download or execute remote JavaScript, WebAssembly, or other remote code.

## Website content and data disclosure

The extension locally inspects limited **Website content** needed to identify a payment surface and visible amount/currency. It can locally store the exact payment URL, payment name, payee name, merchant origin, amount, currency, provider label, pending-payment state, saved-payee memory, and completed-payment history.

The local payment-memory database is not uploaded to XGuard servers by these features.

Only after explicit use of the optional XGuard verification feature can a limited payment-intent record be sent to `xguardgate.com`, including amount/currency, payee or merchant origin, detected provider, and detection confidence.

### Data use

- App functionality: **Yes**
- Payment safety / verification: **Yes, only when explicitly requested**
- Analytics: **No**
- Advertising: **No**
- Personalized advertising: **No**
- Sale of user data: **No**
- Cross-site behavioral profiling: **No**

## Sensitive-data statement

The extension does not request, read, store, or transmit full card PAN, CVV/CVC, card PIN, online banking credentials, wallet private keys, seed phrases, or mnemonics.

## Reviewer test path

1. Install the unpacked extension.
2. Open a normal HTTPS checkout, billing, or transfer-like page.
3. Confirm a floating **XGuard** button appears.
4. Open the panel and name the payment and payee.
5. Choose **ترحيل لغايات الدفع** and confirm the payment appears in the deferred queue.
6. Visit another payment page and defer another payment.
7. Confirm the first recipient appears under saved payees and can be reused.
8. Choose **دفع كل الفواتير** and confirm XGuard starts a local sequence.
9. Complete/mark a child payment and confirm it moves into local history.
10. Open **تقسيم الفواتير**, enter allocations for two saved payees, and confirm child payments are added to the queue.
11. Optionally choose the XGuard verification action and confirm the explicit service request path works.

## Store-review note

XGuard is deliberately user-side. Merchant participation is not required for the floating layer. The extension does not bypass merchant checkout rules, bank authentication, or payment-provider security controls.
