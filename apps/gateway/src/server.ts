import { serve } from "@hono/node-server";
import {
  RoutingEngine,
  SettlementCoordinator,
  SqliteFinancialStore,
} from "@xguard/core";
import { createApp, hashApiKey } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const store = new SqliteFinancialStore(config.databasePath);
store.createMerchant({
  id: "public-testnet",
  name: "Public testnet",
  apiKeyHash: hashApiKey("internal-public-testnet", config.apiKeyPepper),
});
if (process.env.XGUARD_DEMO_API_KEY !== undefined) {
  if (config.mainnetEnabled)
    throw new Error(
      "XGUARD_DEMO_API_KEY cannot be enabled with mainnet; unbacked demo credits are forbidden",
    );
  store.createMerchant({
    id: "demo",
    name: "Demo merchant",
    apiKeyHash: hashApiKey(
      process.env.XGUARD_DEMO_API_KEY,
      config.apiKeyPepper,
    ),
  });
}
const router = new RoutingEngine(
  config.facilitatorDefinitions.map((item) => ({
    id: item.id,
    url: item.url,
    timeoutMs: item.timeoutMs,
    downstreamCostMicroUsd: item.downstreamCostMicroUsd,
    exactEvmTransferMethods: item.exactEvmTransferMethods,
    ...(item.authToken === null
      ? {}
      : {
          authHeaders: async () => ({
            Authorization: `Bearer ${item.authToken}`,
          }),
        }),
  })),
  config.feeMicroUsd,
  0n,
);
const coordinator = new SettlementCoordinator(store, router, {
  mainnetEnabled: config.mainnetEnabled,
  feeMicroUsd: config.feeMicroUsd,
  supportedNetworks: config.supportedNetworks,
});
await coordinator.initialize();
store.markStaleStartedAsAmbiguous(new Date(Date.now() - 120_000).toISOString());
store.expirePreparedPayments(BigInt(Math.floor(Date.now() / 1_000)));
const app = createApp({ config, coordinator, store, router });
const server = serve({ fetch: app.fetch, port: config.port });
console.log(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "gateway_started",
    port: config.port,
    mode: config.mainnetEnabled ? "mainnet-gated" : "testnet-only",
  }),
);

const maintenance = setInterval(() => {
  void coordinator
    .initialize()
    .then(() => {
      const recovered = store.markStaleStartedAsAmbiguous(
        new Date(Date.now() - 120_000).toISOString(),
      );
      const expired = store.expirePreparedPayments(
        BigInt(Math.floor(Date.now() / 1_000)),
      );
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "maintenance_completed",
          staleSubmissionsQuarantined: recovered,
          preparedPaymentsExpired: expired,
        }),
      );
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "maintenance_failed",
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
    });
}, 60_000);
maintenance.unref();

const shutdown = () => {
  clearInterval(maintenance);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
