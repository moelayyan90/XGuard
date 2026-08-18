# XGuard Task Recovery — Privacy Policy

**Effective date:** August 18, 2026  
**Extension:** XGuard Task Recovery 0.3.0  
**Service:** https://xguardgate.com

XGuard is a browser-side task continuity and recovery layer. It can detect likely web-task surfaces such as sign-in and registration, bookings, applications, uploads, checkout/payment, transfers, settings, support forms, and other multi-step HTTPS workflows. It can preserve a local checkpoint, surface visible validation or failure states, identify when human verification is required, and help the user resume from the current task instead of restarting it.

## Local task detection

The extension may inspect the current HTTPS page locally for limited workflow signals such as:

- page hostname, path, URL, and document title;
- visible headings and action labels such as Continue, Submit, Book, Upload, Save, Pay, or their Arabic equivalents;
- the presence and completion state of required fields;
- `aria-invalid`, disabled-action, alert, error, warning, CAPTCHA, MFA/OTP, availability, and retry signals;
- the presence of file-upload controls;
- payment-specific amount/currency/provider hints for the existing payment adapter.

Detection happens in the browser. Merely showing XGuard does not transmit raw page HTML, full page text, form field values, passwords, authentication codes, or payment credentials to XGuard.

## Local recovery checkpoints

When the user chooses **احفظ نقطة رجوع / Save checkpoint**, XGuard can store in `chrome.storage.local`:

- the HTTPS page URL and origin needed to return to the task;
- page title and detected task category;
- the visible label of the likely primary action;
- non-sensitive counts such as required fields, incomplete required fields, and upload controls;
- checkpoint status and timestamps.

XGuard recovery checkpoints do **not** store field values. They do not store passwords, one-time verification codes, card details, bank credentials, uploaded document contents, or private keys.

Checkpoints are automatically bounded in number and age. They exist to help the user return to a task and identify the next incomplete or invalid step.

## Recovery behavior

XGuard can scroll to and focus the first visible invalid field, incomplete required field, error/alert location, or primary action. It does not bypass CAPTCHA, MFA, identity verification, merchant controls, bank authentication, access controls, or website authorization requirements. When those are detected, XGuard labels the state as requiring human intervention and preserves continuity so the user can resume afterward.

XGuard does not automatically submit forms, approve purchases, change bookings, transfer funds, accept terms, or make other consequential decisions merely because a failure was detected.

## Existing local payment memory

The extension retains its payment-specific adapter for users who choose to use it. That adapter can locally store deferred-payment URLs, payment names, payee names, amount/currency, pending-payment state, saved payee memory, and completed-payment history. These payment-memory records remain in `chrome.storage.local` and are not uploaded to XGuard servers by the local memory feature.

The browser-only payment adapter does not claim to convert unrelated merchant transactions into one native bank debit. Each underlying payment remains subject to its merchant, bank, wallet, or payment-provider controls.

## Optional XGuard server-side payment verification

Only after the user explicitly chooses the XGuard payment-verification action can the payment adapter send a limited payment-intent record to `https://xguardgate.com`. Depending on what is available, that record can include amount/currency, payee or merchant origin, detected provider/rail, detection-confidence metadata, and an idempotency identifier.

Users can **Continue without XGuard** server-side verification. Task recovery and local checkpoints do not require a server request.

## Authentication data stored in the browser

When optional server-side payment verification is first used, the extension can create a dedicated XGuard Buyer Pass. The pass is stored in `chrome.storage.local` and sent only to `https://xguardgate.com` for explicit XGuard API requests. It is not inserted into merchant pages or forms.

## Data the extension does not request

XGuard does not request, read for storage, or transmit the user's:

- full payment card number / card number / PAN;
- CVV/CVC or card PIN;
- online-banking password;
- password-manager secrets;
- one-time authentication or MFA codes for storage;
- wallet private key;
- seed phrase or mnemonic;
- uploaded document contents as part of the local checkpoint feature.

The extension does not sell user data, use task/recovery data for advertising, or use it for cross-site behavioral profiling.

## User controls

Users can mark a recovery task complete, replace a checkpoint, remove payment-memory items, stop payment sessions, clear browser-local XGuard data, or uninstall the extension. Uninstalling removes local extension state but does not retroactively delete server-side payment-verification/evidence records that the user explicitly requested earlier.

## Security

XGuard API communication uses HTTPS. The extension does not load remote executable code. Task recovery is designed to work locally and to avoid persisting sensitive form field values.

## Changes to this policy

If the extension's data practices change, this policy and the browser-store disclosures must be updated before or with the corresponding release.

## Contact

Project and privacy questions: https://github.com/moelayyan90/XGuard

Do not post passwords, authentication codes, payment secrets, private keys, seed phrases, card credentials, banking passwords, or private documents in a public issue.
