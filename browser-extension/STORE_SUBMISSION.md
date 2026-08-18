# Browser Store Submission — XGuard Payment Layer 0.2.1

## Package

- Product name: **XGuard Payment Layer**
- Version: **0.2.1**
- Manifest: **Manifest V3**
- Homepage: `https://xguardgate.com/`
- Privacy policy: `https://github.com/moelayyan90/XGuard/blob/main/browser-extension/PRIVACY.md`
- Support/project URL: `https://github.com/moelayyan90/XGuard`

## Single purpose

> Provide a buyer-side payment control layer on HTTPS payment surfaces so users can defer payments, remember and reuse payees, coordinate one or many payments, create split-payment plans, and optionally verify a payment with XGuard without merchant integration.

## Short description

> XGuard appears beside detected payment and transfer actions with defer, Pay All, saved-payee memory, history, and splitting controls.

## Full description

XGuard Payment Layer runs on the buyer side. When the user reaches a likely checkout, billing, payment, beneficiary, or transfer page, XGuard detects limited payment context locally. Version 0.2.1 provides two coordinated user surfaces:

- a compact XGuard rail inserted beside the detected native payment or transfer action; and
- the existing floating XGuard control for the full payment-memory view.

The inline rail exposes **ترحيل لغايات الدفع / Defer for payment** directly beside the native payment action and exposes **دفع كل الفواتير / Pay all bills** whenever deferred bills exist. Opening XGuard from that rail shows deferred bills and remembered payees without requiring the user to open a separate XGuard website.

The user can name a payment and its recipient, defer it, and continue browsing. XGuard remembers the payee, payment label, last amount/currency, and last payment destination locally so that a previous recipient can later be re-deferred or paid again from XGuard memory without being registered again.

The same buyer-side layer supports:

- **دفع هذه فقط / Pay this only** for a single tracked payment;
- **دفع كل الفواتير / Pay all bills** for a local multi-payment session;
- **تقسيم الفواتير / Split bills** to create child payments for multiple saved payees;
- local completed-payment history;
- saved-payee reuse using the last known payment destination;
- optional XGuard payment verification.

The payment queue, saved payees, and payment history are stored in `chrome.storage.local`. Merchant participation is not required for either the inline or floating interface.

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

Payment and transfer pages can exist on any HTTPS domain. The extension locally detects payment actions, renders the inline XGuard rail beside a detected action, and also provides the floating XGuard payment-memory interface. Merchant pages do not need to integrate XGuard.

The extension intentionally does **not** run on `http://*/*`.

## Remote code

**No.** The extension package contains its executable JavaScript. It does not download or execute remote JavaScript, WebAssembly, or other remote code.

## Website content and data disclosure

The extension locally inspects limited **Website content** needed to identify a payment/transfer action and a visible amount/currency. It can locally store the exact payment URL, payment name, payee name, merchant origin, amount, currency, provider label, pending-payment state, saved-payee memory, and completed-payment history.

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
2. Open a normal HTTPS checkout, billing, or transfer-like page with a visible Pay/Transfer control.
3. Confirm an XGuard control rail appears immediately beside the detected native action.
4. Confirm the rail includes **ترحيل لغايات الدفع** and, once a bill exists, **دفع كل الفواتير**.
5. Open the inline XGuard list, name the payment and payee, and defer it.
6. Visit another payment page and defer another payment.
7. Confirm the first recipient appears under saved payees.
8. Use **رحّل** on a saved payee to recreate a deferred payment from the remembered destination.
9. Use **ادفع** on a saved payee to start a single-payment session from the remembered destination.
10. Choose **دفع كل الفواتير** and confirm XGuard starts the deferred-payment sequence.
11. Open **تقسيم الفواتير**, enter allocations for two saved payees, and confirm child payments are added to the queue.
12. Optionally use the full floating layer's XGuard verification action and confirm the explicit service request path works.

## Store-review note

XGuard is deliberately user-side. Merchant participation is not required for the inline rail or floating payment layer. The extension does not bypass merchant checkout rules, bank authentication, or payment-provider security controls.
