# CompatRelay

CompatRelay is a runtime compatibility relay for API sunsets. It preserves bounded legacy request/response contracts while forwarding work to successor APIs.

## Current bridge packs

- OpenAI Assistants API v2 → Responses + Conversations (bounded semantic compatibility)
- Cloudflare Workers KV legacy namespace routes → current storage/kv routes (exact path compatibility)

## Safety model

Production translations are deterministic. Generative AI is limited to scheduled deprecation intelligence and candidate adapter analysis; it never rewrites live customer traffic ad hoc. Provider Authorization headers are forwarded request-by-request and are not persisted.

## Operations

The Worker exposes health, status, self-test, docs, pricing, bridge registry, a free project-key registration endpoint, usage metering, and scheduled official-deprecation monitoring.
