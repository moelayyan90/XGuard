# Browser Store Submission — XGuard Task Recovery 0.3.0

## Package

- Product name: **XGuard Task Recovery**
- Version: **0.3.0**
- Manifest: **Manifest V3**
- Homepage: `https://xguardgate.com/`
- Privacy policy: `https://github.com/moelayyan90/XGuard/blob/main/browser-extension/PRIVACY.md`
- Support/project URL: `https://github.com/moelayyan90/XGuard`

## Single purpose

> Provide task continuity and recovery for HTTPS web workflows by detecting meaningful task surfaces, preserving local checkpoints, surfacing visible failures or human-verification requirements, and helping the user resume safely without storing sensitive field values.

Payment controls remain an adapter inside this single continuity/recovery purpose; payment is no longer the definition of the extension.

## Short description

> XGuard appears on active web tasks, remembers a safe checkpoint, detects when the workflow breaks, and guides the user back to the next recoverable step.

## Full description

XGuard Task Recovery is a user-side control layer for multi-step HTTPS workflows. It can recognize common task surfaces including:

- sign-in, registration, verification and account workflows;
- bookings, reservations and appointments;
- applications, requests and claims;
- file/document upload steps;
- checkout, payment and transfer flows;
- settings/profile changes;
- support, refund, return and dispute forms;
- generic form-based tasks with a clear primary action.

When a meaningful task is detected, XGuard shows a compact top-level **Task Control** window. The window reports the type of operation, the likely primary action, and whether the task is healthy, blocked, or requires human intervention.

If a page exposes visible validation errors, incomplete required fields, error alerts, disabled primary actions, temporary retry states, availability failures, CAPTCHA, OTP, MFA or related verification requirements, XGuard switches into Recovery Mode. It can scroll to and focus the first recoverable problem. It does not bypass access controls or make a consequential decision on the user's behalf.

The user can save a local checkpoint before or during a task. A checkpoint stores only the page URL/origin, title, task category, visible primary-action label, non-sensitive field counts, and timestamps. **Field values are not stored by the recovery checkpoint feature.**

The extension retains the existing XGuard payment adapter for deferred payments, saved payees, Pay All sequences and payment-specific verification. These controls are secondary capabilities inside the broader task-continuity product.

## Suggested category

**Productivity** — task continuity and recovery utility.

## Permission justifications

### `storage`

Required for local recovery checkpoints and the existing local payment-memory state. Recovery checkpoints do not store sensitive field values.

### `https://xguardgate.com/*`

Required only for explicit XGuard service features such as optional payment verification and related XGuard API calls. Local task recovery does not require sending the task page to XGuard.

### Website content access: `https://*/*`

Digital workflows can exist on any HTTPS domain. The extension locally inspects limited page structure and visible workflow signals so it can identify a meaningful task, detect validation/failure states, and render the recovery interface. It intentionally does not run on `http://*/*`.

## Remote code

**No.** The extension package contains its executable JavaScript. It does not download or execute remote JavaScript, WebAssembly, or other remote code.

## Website content and data disclosure

The extension locally inspects limited **Website content** needed for task continuity: URL/title, visible headings/action labels, required-field completion state, validation/error indicators, upload-control presence, and human-verification signals. It does not persist raw page HTML or form field values as task checkpoints.

The existing payment adapter may locally store deferred-payment metadata such as URL, payment/payee names, amount/currency and payment history. Those local payment-memory records are not uploaded by the memory feature.

Only explicit XGuard server features, such as optional payment verification, send the limited data documented in `PRIVACY.md` to `xguardgate.com`.

### Data use

- App functionality: **Yes**
- Task continuity / recovery: **Yes**
- Payment safety / verification: **Yes, only when explicitly requested**
- Analytics: **No**
- Advertising: **No**
- Personalized advertising: **No**
- Sale of user data: **No**
- Cross-site behavioral profiling: **No**

## Sensitive-data statement

The recovery checkpoint feature does not store form field values. The extension does not request or persist full card PAN, CVV/CVC, card PIN, online banking credentials, password-manager secrets, MFA/OTP codes, wallet private keys, seed phrases, mnemonics, or uploaded document contents.

## Reviewer test path

1. Install the unpacked extension.
2. Open an HTTPS page containing a multi-step form or workflow with a clear Continue/Submit/Save/Book/Upload/Pay action.
3. Confirm the **XGuard Task Control** bar appears near the top of the page.
4. Open it and choose **احفظ نقطة رجوع / Save checkpoint**.
5. Leave a required field empty or trigger a normal site validation error.
6. Confirm XGuard switches to **تعطل مكتشف / Attention** and **افحص موضع التعطل** scrolls/focuses the first recoverable problem.
7. On a page containing CAPTCHA/MFA/OTP language, confirm XGuard reports **تدخل مطلوب / Human Required** and does not bypass the verification.
8. Use **استئناف المهمة / Resume task** to return/focus the saved task state.
9. Mark the task complete and confirm the active checkpoint is closed.
10. Optionally visit a payment/transfer page to confirm the existing payment adapter remains available as a secondary feature.

## Store-review note

XGuard is deliberately user-side. It does not bypass website authorization, CAPTCHA, MFA, bank authentication, merchant checkout rules, or payment-provider security controls. Its single purpose is to preserve task continuity and help the user recover from visible workflow failures safely.
