import { resolve } from "node:path";
import {
  SqliteFinancialStore,
  evaluateOwnerPayout,
  formatMicroUsd,
} from "../packages/core/dist/index.js";

const databasePath = resolve(
  process.argv[2] ?? process.env.XGUARD_DATABASE_PATH ?? "./xguard.db",
);
const store = new SqliteFinancialStore(databasePath);
try {
  const report = store.getFinancialReport(
    Number.parseInt(process.env.OPERATING_RESERVE_PERCENT ?? "20", 10),
    BigInt(process.env.MIN_OPERATING_RESERVE_MICRO_USD ?? "25000000"),
  );
  const decision = evaluateOwnerPayout(
    report,
    {
      destinationVerified: process.env.PAYOUT_DESTINATION_VERIFIED === "true",
      kycComplete: process.env.PAYOUT_KYC_COMPLETE === "true",
      providerAuthorized: process.env.PAYOUT_PROVIDER_AUTHORIZED === "true",
      availableBalanceCertain:
        process.env.PAYOUT_AVAILABLE_BALANCE_CERTAIN === "true",
      reconciliationConsistent:
        process.env.PAYOUT_RECONCILIATION_CONSISTENT === "true",
      providerOperational: process.env.PAYOUT_PROVIDER_OPERATIONAL === "true",
      previousPayoutUnambiguous:
        process.env.PAYOUT_PREVIOUS_UNAMBIGUOUS === "true",
      fundsFinal: process.env.PAYOUT_FUNDS_FINAL === "true",
    },
    {
      enabled: process.env.AUTO_OWNER_PAYOUT === "true",
      minimumPayoutMicroUsd: BigInt(
        process.env.OWNER_PAYOUT_MIN_MICRO_USD ?? "100000000",
      ),
      providerMinimumMicroUsd: BigInt(
        process.env.PAYOUT_PROVIDER_MIN_MICRO_USD ?? "0",
      ),
      providerFeeMicroUsd: BigInt(
        process.env.PAYOUT_PROVIDER_FEE_MICRO_USD ?? "0",
      ),
    },
  );
  console.log(
    JSON.stringify({
      event: "owner_payout_check",
      decision: decision.state,
      amountUsd: formatMicroUsd(decision.amountMicroUsd),
      blockerCodes: decision.reasons,
      transferSubmitted: false,
      providerAdapterState: "EXTERNAL_BLOCKER",
    }),
  );
  if (decision.state === "READY") process.exitCode = 3;
} finally {
  store.close();
}
