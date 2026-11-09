const DAY_MS = 86400000;
const MINIMUM_REFRESH_MS = 900000;
const CATALOG_READ_RESERVE = 1000000;

// A local component allocation, not an observation of the account's remaining
// quota. Leave most of the 5M free daily SQL reads for facts and paid state.
export function catalogCapacity(rows: unknown) {
  const measured = typeof rows === 'number' && Number.isFinite(rows) && rows > 0 ? Math.ceil(rows) : null;
  // A 25% margin accommodates some growth between measured refreshes. The
  // persisted as_of makes this pacing survive object eviction and restarts.
  const interval = measured === null ? MINIMUM_REFRESH_MS
    : Math.min(DAY_MS, Math.max(MINIMUM_REFRESH_MS, Math.ceil(measured * 1.25 * DAY_MS / CATALOG_READ_RESERVE)));
  return {
    policy: 'measured-catalog-read-reserve-v1',
    component: 'public-catalog',
    allocated_rows_per_day: CATALOG_READ_RESERVE,
    measured_rows_per_refresh: measured,
    minimum_refresh_interval_seconds: MINIMUM_REFRESH_MS / 1000,
    refresh_interval_seconds: Math.ceil(interval / 1000),
    projected_rows_per_day: measured === null ? null : Math.ceil(measured * DAY_MS / interval),
    projected_rows_at_minimum_interval: measured === null ? null : measured * DAY_MS / MINIMUM_REFRESH_MS,
    pacing_active: interval > MINIMUM_REFRESH_MS,
    scope: 'Projection for catalog SQL reads only. Not measured account-wide usage, a hard quota reservation, an invoice, or a guarantee of daily availability.',
  };
}
