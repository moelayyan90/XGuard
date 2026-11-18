const allowances = { rows_read: 5000000, rows_written: 100000 };

// A rate projection is an early warning, never a measured remaining balance.
export function capacitySignals(totals, start, end) {
  const elapsed = Date.parse(end) - Date.parse(start);
  if (!totals || !Number.isFinite(elapsed) || elapsed <= 0 || Object.keys(allowances).some(k => !Number.isSafeInteger(totals[k]) || totals[k] < 0)) return null;
  return Object.entries(allowances).map(([metric, allowance]) => {
    const used = totals[metric], percent = used * 100 / allowance;
    const projected = elapsed >= 3600000 ? Math.ceil(used * 86400000 / elapsed) : null;
    return { metric, used, allowance, percent: Math.round(percent * 100) / 100,
      threshold: [90, 75, 50].find(t => percent >= t) || 0,
      projected_day_total: projected,
      projected_exhaustion_at: projected !== null && projected >= allowance && used > 0 ? new Date(Date.parse(start) + Math.max(elapsed, Math.ceil(allowance * elapsed / used))).toISOString() : null,
      projection_scope: 'UTC-day average rate only; workload and provider reporting lag can change. Not a guaranteed exhaustion time.' };
  });
}
