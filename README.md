# XGuard Email Shield

XGuard Email Shield is a self-service email-risk verification API for signup, checkout, registration, and form workflows.

## Production

- Website: https://xguardgate.com
- API: https://api.xguardgate.com
- Health: https://api.xguardgate.com/healthz
- OpenAPI: https://api.xguardgate.com/openapi.json
- Cloudflare Worker: `xguard-mainnet`
- D1 database: `xguard-email-shield`

## Verification

XGuard performs practical syntax validation, MX / Null MX checks, RFC-compatible A/AAAA fallback detection, disposable-domain detection, role-address detection, and common-provider typo detection. Mailbox-level deliverability is reported only when an explicitly configured upstream verifier supplies that evidence; otherwise it remains `unknown`.

Submitted email addresses are processed transiently and are not persisted. API keys are stored only as SHA-256 hashes.

## API

Create a free key:

```bash
curl -X POST https://api.xguardgate.com/v1/keys/free
```

Verify one address:

```bash
curl https://api.xguardgate.com/v1/verify \
  -H "Authorization: Bearer xg_live_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Batch verification supports up to 100 addresses per request.

## WordPress / WooCommerce

The integration is in `apps/email-shield/integrations/wordpress/`. The release workflow packages it automatically as `xguard-email-shield.zip`.

## Repository layout

- `apps/email-shield/` — production Worker, website, verifier, D1 migration, WordPress integration
- `commercial/rapidapi-xguard/` — marketplace OpenAPI contract
- `.github/workflows/` — CI, CodeQL, Cloudflare deployment, WordPress release, RapidAPI publication

The pre-conversion XGuard payment/inference code is preserved in the branch `legacy-xguard-before-email-shield`; it is intentionally absent from `main`.

## License

Apache-2.0.
