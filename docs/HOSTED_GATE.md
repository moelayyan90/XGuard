# XGuard Hosted Gate

XGuard Hosted Gate lets an existing reverse proxy make an x402 payment decision before a request reaches the application. The application itself does not need the XGuard SDK or x402 middleware.

```text
client / agent
    |
    v
existing reverse proxy
    |  forward-auth / auth subrequest
    v
https://api.xguardgate.com/v1/gate/authorize
    |  XGuard /verify + /settle
    v
allow origin only after successful settlement
```

## Protocol

Gate endpoint:

```text
GET|POST https://api.xguardgate.com/v1/gate/authorize
```

Required policy headers:

- `X-XGuard-Pay-To`: merchant Base-mainnet receiving address.
- `X-XGuard-Amount`: USDC atomic amount. Example: `10000` = 0.01 USDC.
- resource identity: either `X-XGuard-Resource-URL` or trusted `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Uri` from the reverse proxy.

Optional:

- `X-XGuard-Key`: XGuard Usage Credits key after the free allowance.
- `X-XGuard-Description`
- `X-XGuard-Mime-Type`
- `X-XGuard-Timeout-Seconds`

Current hosted policy intentionally starts narrow: `exact` + Base mainnet (`eip155:8453`) + Base USDC. Unsupported networks/assets fail closed instead of being silently reinterpreted.

When the client has not paid, Hosted Gate returns a standard x402 v2 challenge with `PAYMENT-REQUIRED`. The client retries the original request with `PAYMENT-SIGNATURE`; the reverse proxy passes that header to Hosted Gate. XGuard verifies and settles before returning a successful authorization response. Ambiguous settlement errors remain fail-closed.

## Nginx — complete transparent path

Nginx `auth_request` recognizes 2xx as allow and 401/403 as deny, so Hosted Gate has a compatibility mode. The subrequest receives a 401 carrying the x402 challenge; the public location maps it back to 402.

```nginx
location /premium/ {
    auth_request /_xguard_auth;

    auth_request_set $xguard_payment_required $upstream_http_payment_required;
    auth_request_set $xguard_payment_response $upstream_http_payment_response;
    auth_request_set $xguard_receipt $upstream_http_x_xguard_receipt_id;

    error_page 401 = @xguard_payment_required;

    add_header PAYMENT-RESPONSE $xguard_payment_response always;
    add_header X-XGuard-Receipt-Id $xguard_receipt always;

    proxy_pass https://private-origin.example;
}

location = /_xguard_auth {
    internal;
    proxy_pass https://api.xguardgate.com/v1/gate/authorize;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";

    proxy_set_header X-XGuard-Gateway-Mode nginx-auth-request;
    proxy_set_header X-XGuard-Pay-To 0xYOUR_BASE_RECEIVING_ADDRESS;
    proxy_set_header X-XGuard-Amount 10000;
    proxy_set_header X-XGuard-Resource-URL https://$host$request_uri;
    proxy_set_header PAYMENT-SIGNATURE $http_payment_signature;

    # Optional after the XGuard free allowance:
    # proxy_set_header X-XGuard-Key YOUR_USAGE_CREDITS_KEY;
}

location @xguard_payment_required {
    add_header PAYMENT-REQUIRED $xguard_payment_required always;
    return 402;
}
```

Keep the origin private or firewall it so clients cannot bypass Nginx and call it directly.

## Caddy forward_auth

```caddyfile
api.example.com {
    forward_auth https://api.xguardgate.com {
        uri /v1/gate/authorize
        header_up X-XGuard-Pay-To 0xYOUR_BASE_RECEIVING_ADDRESS
        header_up X-XGuard-Amount 10000
        header_up X-XGuard-Resource-URL https://api.example.com{uri}
        header_up PAYMENT-SIGNATURE {header.PAYMENT-SIGNATURE}
        copy_headers PAYMENT-RESPONSE>X-XGuard-Payment-Response X-XGuard-Receipt-Id
    }

    reverse_proxy private-origin:8080
}
```

## Traefik ForwardAuth

Configure the ForwardAuth address as:

```text
https://api.xguardgate.com/v1/gate/authorize
```

Pass `PAYMENT-SIGNATURE`, `X-XGuard-Pay-To`, `X-XGuard-Amount` and the trusted forwarded resource identity. Include `PAYMENT-RESPONSE` and `X-XGuard-Receipt-Id` in `authResponseHeaders` when the next hop needs them.

## Security rules

1. Set `X-XGuard-Pay-To` and `X-XGuard-Amount` in trusted proxy configuration, never from untrusted public input.
2. Hosted Gate accepts the dedicated `X-XGuard-Key` only; do not repurpose arbitrary upstream Authorization headers.
3. Keep the origin private or network-restricted so there is no bypass route around the gate.
4. Verification success is not access permission; Hosted Gate authorizes only after successful settlement.
5. Ambiguous settlement failures return 5xx and never authorize the origin.
6. The signed payment is bound to scheme/network/asset/payTo/amount/resource before `/verify` or `/settle` is called.

## Machine discovery

```text
GET https://api.xguardgate.com/v1/gate
```
