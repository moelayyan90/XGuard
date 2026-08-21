# Commerce safety gates

- Public HTTPS feed URLs only; local/private targets are rejected.
- Commerce admin endpoints require the existing XGuard admin token.
- Exact normalized product key matching.
- Stock verification and supplier confidence are required for READY.
- Buyer demand evidence and public buyer contact are required for READY.
- Payment-before-purchase terms are required for READY.
- Restricted goods and blocked-jurisdiction checks fail closed.
- Minimum net profit and margin gates are applied after all modeled landed costs plus reserve.
- Outreach is deduplicated and rate capped.
