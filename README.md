# XGuard Email Shield

XGuard is a self-service email-risk verification layer for signup, checkout, registration and form workflows.

## What it does

- Validates practical email syntax before network work.
- Resolves MX and RFC-compatible fallback address records through DNS-over-HTTPS.
- Detects Null MX domains that explicitly accept no email.
- Rejects known and heuristic disposable email domains.
- Flags role addresses and likely typos in common mailbox providers.
- Optionally delegates mailbox-level verification to a configured upstream without pretending SMTP probing is available when it is not.
- Does **not** store submitted email addresses.

## API

Production: `https://api.xguardgate.com`

Create a free key:

```bash
curl -X POST https://api.xguardgate.com/v1/keys/free
```

Verify:

```bash
curl https://api.xguardgate.com/v1/verify \
  -H "Authorization: Bearer xg_live_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Batch verification supports up to 100 addresses per request.

## WordPress / WooCommerce

The packaged plugin is published automatically from `apps/email-shield/integrations/wordpress/` as a GitHub release asset. Install it, paste an XGuard API key once, and WordPress registration plus WooCommerce checkout validation become automatic.

## Pricing model

Target public price: **$0.003 per verification**, with 100 free checks for self-service evaluation. Marketplace billing can be distributed through the XGuard RapidAPI listing; direct keys use prepaid credits in D1.

## Cloudflare

The production Worker is `xguard-mainnet`, deployed to:

- `https://xguardgate.com`
- `https://api.xguardgate.com`

State is stored in D1 database `xguard-email-shield`. Deployment and migrations run from `.github/workflows/deploy-mainnet.yml` using repository Cloudflare secrets.

## Privacy and correctness

Email inputs are processed transiently and are not persisted. API key secrets are persisted only as SHA-256 hashes. Without an explicitly configured mailbox-verification upstream, XGuard reports mailbox deliverability as `unknown`; it never labels an address mailbox-deliverable based only on DNS.

Legacy XGuard experiments remain in repository history, but the production deployment and public product surface are Email Shield.
