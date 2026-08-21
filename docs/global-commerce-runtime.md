# Runtime behavior

The commerce cron runs every minute under the mainnet worker. It refreshes enabled normalized feeds, rebuilds exact-key demand/offer matches, computes full landed cost and reserve, ranks opportunities, and sends at most the configured daily cap of targeted official XGuard emails for opportunities whose status is READY. All commerce administration endpoints are protected by the existing XGuard admin-token hash.
