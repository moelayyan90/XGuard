# XGuard Universal Gate

The same XGuard payment-enforcement runtime as Edge Gate, packaged as a normal Node server and Docker image so it can sit in front of APIs on AWS, GCP, Azure, Kubernetes, VPS hosts, Docker Compose, or any reverse-proxy stack.

```text
internet / agents
      |
      v
XGuard Universal Gate :8080
      |   x402 challenge + XGuard verify/settle
      v
existing HTTPS origin
```

No application SDK is required in the origin.

## Docker

After the public image is published:

```bash
docker run --rm -p 8080:8080 \
  -e ORIGIN_URL=https://api.example.com \
  -e PAY_TO=0xYOUR_RECEIVING_ADDRESS \
  -e NETWORK=eip155:8453 \
  -e 'PROTECTED_PATTERNS=[{"method":"GET","pattern":"/premium/*","price":"$0.01"}]' \
  ghcr.io/moelayyan90/xguard-gate:5.0.1
```

For OpenAPI AutoGate:

```bash
docker run --rm -p 8080:8080 \
  -e ORIGIN_URL=https://api.example.com \
  -e PAY_TO=0xYOUR_RECEIVING_ADDRESS \
  -e NETWORK=eip155:8453 \
  -e AUTO_GATE_OPENAPI=true \
  -e OPENAPI_URL=https://api.example.com/openapi.json \
  -e 'DEFAULT_PRICE=$0.01' \
  ghcr.io/moelayyan90/xguard-gate:5.0.1
```

The sample zero address is intentionally rejected by the runtime. A real merchant receiving address is required before a protected request can be paid.

## Docker Compose

From the repository root:

```bash
docker compose -f apps/universal-gate/compose.yaml up
```

Replace `ORIGIN_URL` and `PAY_TO` before production use.

## Kubernetes / ingress

Deploy the container as a normal service, then route paid API traffic to `xguard-gate:8080` instead of directly to the origin service. The origin can remain private and reachable only from the gate network path.

For a stronger enforcement topology:

```text
Ingress -> xguard-gate Service -> private origin Service
```

If the ingress has no route directly to the origin, bypassing the XGuard gate is structurally prevented at the cluster routing layer.

## XGuard Usage Credits

`XGUARD_LICENSE_KEY` is optional during the configured free allowance. After that allowance, provide it through the platform's secret manager. Never put it in an image, Compose file, or Kubernetes ConfigMap.

## Diagnostics

- `GET /__xguard/health`
- `GET /__xguard/config`
- `GET /__xguard/openapi` when AutoGate is enabled

## Build locally

The Docker build context must be the repository root because the portable server reuses the tested Edge Gate package:

```bash
docker build -f apps/universal-gate/Dockerfile -t xguard-gate:local .
```
