# XGuard paid MCP example

This example runs an MCP stdio server whose `safe_echo` tool is protected by x402 and routed through the XGuard production gateway on Base mainnet.

**The paid tool can settle real Base mainnet USDC.** The process refuses to start until both of these are supplied explicitly:

- `XGUARD_API_KEY` — merchant API key from XGuard mainnet registration;
- `XGUARD_EXAMPLE_PAY_TO` — non-zero Base mainnet address that receives the tool's advertised `$0.001` x402 payment.

The gateway defaults to:

```text
https://xguardgate.com
```

Set `XGUARD_URL` only when you deliberately want another explicit environment. Never place a wallet private key in the example process or repository.

The seller-advertised tool price and XGuard service fee are separate. The tool advertises `$0.001`; XGuard's `$0.002` successful-settlement service fee is charged against the authenticated merchant's prepaid XGuard service balance.

For non-billable Base Sepolia testing, use the testnet gateway and network explicitly in a separate test configuration rather than treating testnet as this example's default.
