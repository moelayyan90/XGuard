# Browser Store Submission — XGuard Pay All 0.1.0

## Package

- Product name: **XGuard Pay All**
- Version: **0.1.0**
- Manifest: **Manifest V3**
- Homepage: `https://xguardgate.com/`
- Privacy policy: `https://github.com/moelayyan90/XGuard/blob/main/browser-extension/PRIVACY.md`
- Support/project URL: `https://github.com/moelayyan90/XGuard`

## Single purpose

> Provide a buyer-side floating payment cart on HTTPS checkout pages so a user can collect payments from multiple websites, review them in one place, coordinate a Pay All session, and optionally verify an individual payment with XGuard.

## Short description

> Save checkout payments from different sites into one floating XGuard cart and coordinate Pay All without merchant integration.

## Full description

XGuard Pay All is a buyer-side browser layer. When the user reaches a likely checkout page, the extension detects checkout context locally and shows a small floating XGuard control.

The user can save the current payment into a local Pay All cart, continue browsing to other websites, add more payments, and then start one Pay All session. XGuard guides the user through the saved merchant checkouts in order and tracks the local child-payment sequence.

The cart is stored in `chrome.storage.local`. The extension does not require the merchant to install XGuard, create an API key, or modify its checkout.

The current browser-only Pay All mode does not pretend that unrelated merchant card transactions have become one native bank debit. The underlying merchant payment remains the merchant's normal checkout and may still require the user's card/wallet action or bank authentication. A true one-debit/many-recipient mode requires an authorized payment rail that supports batch authorization.

The extension also retains the optional XGuard payment-decision feature. When the user explicitly asks XGuard to verify the current payment, a limited payment-intent record is sent to `xguardgate.com` and XGuard returns a decision/evidence result.

XGuard Pay All does not request the user's full card number, CVV/CVC, PIN, online-banking password, wallet private key, seed phrase, or mnemonic.

## Suggested category

**Shopping** — checkout/payment utility.

## Permission justifications

### `storage`

Required to store the local Pay All cart, active Pay All session, and the optional XGuard Buyer Pass used only for explicit XGuard service requests.

### `https://xguardgate.com/*`

Required only for explicit XGuard service features such as payment verification, Buyer Pass creation, and service-balance operations.

### Checkout-page access: `https://*/*`

Required because checkout pages can exist on any HTTPS merchant domain. The content script performs local checkout detection and renders the floating XGuard Pay All interface. Merchant pages do not need to integrate XGuard.

The extension intentionally does **not** run on `http://*/*`.

## Remote code

**No.** The extension package contains its executable JavaScript. It does not download or execute remote JavaScript, WebAssembly, or other remote code.

## Website content and data disclosure

The extension locally inspects limited **Website content** needed to identify a checkout and visible payment total. The Pay All cart can locally store the exact checkout URL, merchant hostname, page title, amount, currency, provider label, and cart/session state.

The current Pay All cart is browser-local and is not uploaded to XGuard servers.

Only after explicit use of the optional XGuard verification feature can a limited payment-intent record be sent to `xguardgate.com`, including amount/currency, merchant origin, detected provider, and detection confidence.

### Data use

- App functionality: **Yes**
- Payment safety / verification: **Yes, only when explicitly requested**
- Analytics: **No**
- Advertising: **No**
- Personalized advertising: **No**
- Sale of user data: **No**
- Cross-site behavioral profiling: **No**

## Sensitive-data statement

The extension does not request, read, store, or transmit:

- full card PAN;
- CVV/CVC;
- card PIN;
- online banking credentials;
- wallet private keys;
- seed phrases or mnemonics.

## Reviewer test path

1. Install the unpacked extension.
2. Open a normal HTTPS checkout-like page.
3. Confirm a floating **XGuard** button appears.
4. Open the panel and choose **احجز هذه الدفعة / Add this payment**.
5. Navigate to another checkout and add a second payment.
6. Confirm the cart persists across the two merchant domains.
7. Choose **ادفع الكل / Pay All**.
8. Confirm XGuard starts a single local session and navigates the saved checkout sequence without reading payment credential fields.
9. Optionally choose the XGuard verification action and confirm the explicit service request path still works.

## Store-review note

XGuard Pay All is deliberately user-side. Merchant participation is not required for the floating cart UI. The extension does not bypass merchant checkout rules, bank authentication, or payment-provider security controls.
