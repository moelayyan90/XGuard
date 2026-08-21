# Global commerce feed schema

Feed endpoints registered with `/v1/commerce/feeds` must return JSON with optional `demands` and `offers` arrays matching `scripts/commerce-seed.example.json`. XGuard does not bypass logins, anti-bot controls, or access restrictions; feed adapters must expose data the operator is authorized to consume.
