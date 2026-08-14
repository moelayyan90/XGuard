import { resolve } from "node:path";
import {
  SqliteFinancialStore,
  formatMicroUsd,
} from "../packages/core/dist/index.js";

const databasePath = resolve(
  process.argv[2] ?? process.env.XGUARD_DATABASE_PATH ?? "./xguard.db",
);
const store = new SqliteFinancialStore(databasePath);
try {
  const quarantined = store.markStaleStartedAsAmbiguous(
    new Date(Date.now() - 120_000).toISOString(),
  );
  const expired = store.expirePreparedPayments(
    BigInt(Math.floor(Date.now() / 1_000)),
  );
  const ledger = store.verifyLedgerBalance();
  const report = store.getFinancialReport(
    Number.parseInt(process.env.OPERATING_RESERVE_PERCENT ?? "20", 10),
    BigInt(process.env.MIN_OPERATING_RESERVE_MICRO_USD ?? "25000000"),
  );
  console.log(
    JSON.stringify({
      event: "reconciliation_completed",
      ledgerBalanced: ledger.balanced,
      imbalancedTransactionCount: ledger.imbalancedTransactionIds.length,
      staleSubmissionsQuarantined: quarantined,
      preparedPaymentsExpired: expired,
      ambiguousSettlementCount: report.ambiguousSettlementCount.toString(),
      grossRevenueUsd: formatMicroUsd(report.grossRevenueMicroUsd),
      operatingCostsUsd: formatMicroUsd(report.operatingCostsMicroUsd),
      distributableProfitUsd: formatMicroUsd(report.ownerDistributableMicroUsd),
      payoutSuspended: !ledger.balanced || report.ambiguousSettlementCount > 0n,
    }),
  );
  if (!ledger.balanced || report.ambiguousSettlementCount > 0n)
    process.exitCode = 2;
} finally {
  store.close();
}
