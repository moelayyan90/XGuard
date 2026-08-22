# XGuard Web Extractor — RapidAPI

Secure HTTP surface for selling XGuard extraction through RapidAPI's usage billing.

## Endpoint

`POST /v1/extract`

```json
{
  "url": "https://example.com/article",
  "includeLinks": true,
  "maxContentChars": 200000,
  "timeoutMs": 20000,
  "maxHtmlBytes": 5000000
}
```

The response contains clean Markdown, text, metadata, links, final URL, HTTP status, and extraction timestamp.

## Provider security

Production startup requires `RAPIDAPI_PROXY_SECRET`. Every extraction request must carry the matching `X-RapidAPI-Proxy-Secret` inserted by RapidAPI. The health endpoint remains public.

The fetcher also validates every redirect, resolves DNS through a guarded dispatcher, and blocks private, loopback, link-local, multicast, and internal destinations.

## Run

```bash
npm install
RAPIDAPI_PROXY_SECRET='provider-dashboard-secret' NODE_ENV=production npm start
```

Default port: `8080`.

## RapidAPI definition

Import `openapi.yaml` into the provider definition, set the provider origin, enable RapidAPI proxy billing, then store the same proxy secret as `RAPIDAPI_PROXY_SECRET` in the runtime environment.
