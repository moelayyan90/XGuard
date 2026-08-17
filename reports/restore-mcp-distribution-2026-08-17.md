# Restore MCP distribution — 2026-08-17

This change set restores XGuard's MCP publication and canonical-domain verification after the 0.5.0 Registry validation failure.

- MCP Registry metadata description is reduced below the 100-character limit and versioned as 0.5.1.
- Runtime MCP discovery surfaces are aligned to 0.5.1.
- VerifyMCP live checks use `https://xguardgate.com` rather than the legacy workers.dev hostname.
- The canonical MCP manifest is explicitly validated during VerifyMCP checks.
- MCP Repository and A2A Registry refreshes run automatically from the canonical domain when distribution metadata changes.

The existing publication workflows remain idempotent and treat duplicate directory registration as success where supported.
