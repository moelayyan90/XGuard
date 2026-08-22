# Upstream providers

XGuard accepts up to three OpenAI-compatible upstream slots. A slot is a compute route, not an endorsement of an API reseller.

## Required activation evidence

Every route requires:

- an HTTPS base URL on `XGUARD_UPSTREAM_HOST_ALLOWLIST`;
- an API key stored as a Cloudflare secret;
- exact upstream and network-facing model IDs;
- current input and output cost in micro-USD per million tokens;
- the intended sale price;
- an explicit network fee percentage and variable infrastructure cost per request;
- `RESALE_APPROVED=true`;
- an HTTPS legal evidence URL for a contract, partner authorization, or self-hosted compute authority;
- a successful health check.

If any field is absent, the model is `BLOCKED`. Setting an environment variable does not itself create legal permission; the operator is responsible for the evidence it references.

## Commercial audit

| Candidate                                              | Current disposition        | Reason                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Self-hosted vLLM on rented compute                     | preferred, review required | XGuard controls the inference endpoint; compute terms and model license must permit the workload                                                                                     |
| Runpod compute                                         | review required            | [Runpod Terms](https://www.runpod.io/legal/terms-of-service) prohibit reselling credits and impose service restrictions; compute use is not treated as blanket API resale permission |
| DGrid consumer Gateway                                 | excluded                   | [DGrid AI Gateway Terms](https://docs.dgrid.ai/ai-gateway/terms-of-service) prohibit resale without written permission; it also creates circular routing                             |
| Cloudflare Workers AI                                  | excluded from resale route | no explicit resale authority is configured for XGuard                                                                                                                                |
| OpenRouter                                             | excluded from resale route | no explicit resale authority is configured for XGuard                                                                                                                                |
| Direct OpenAI, Anthropic, Google, xAI, or DeepSeek API | contract required          | credentials alone do not prove the right to expose a raw third-party inference channel through DGrid                                                                                 |

The safe first production route is a commercially licensed open model hosted on compute whose terms permit XGuard's service, or a provider contract that explicitly authorizes redistribution.

## Routing

Eligible routes are ordered by:

1. profit-guard eligibility;
2. fresh `HEALTHY` before `DEGRADED` state;
3. lower configured token cost;
4. higher 24-hour success rate;
5. lower observed latency.

Retryable 429 and 5xx responses fail over. Non-retryable client errors stop to avoid multiplying cost. Provider names and secrets are not returned to network callers.

## Configuration names

For slot `N` in `1..3`:

```text
XGUARD_UPSTREAM_N_BASE_URL
XGUARD_UPSTREAM_N_API_KEY                 # secret
XGUARD_UPSTREAM_N_NAME
XGUARD_UPSTREAM_N_MODEL
XGUARD_UPSTREAM_N_NETWORK_MODEL
XGUARD_UPSTREAM_N_RESALE_APPROVED
XGUARD_UPSTREAM_N_LEGAL_EVIDENCE_URL
XGUARD_UPSTREAM_N_INPUT_MICRO_USD_PER_MILLION
XGUARD_UPSTREAM_N_OUTPUT_MICRO_USD_PER_MILLION
XGUARD_UPSTREAM_N_SALE_INPUT_MICRO_USD_PER_MILLION
XGUARD_UPSTREAM_N_SALE_OUTPUT_MICRO_USD_PER_MILLION
XGUARD_NETWORK_FEE_PERCENT
XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST
```
