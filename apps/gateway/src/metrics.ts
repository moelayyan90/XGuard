export class GatewayMetrics {
  private readonly counters = new Map<string, bigint>();
  private readonly latenciesMs: number[] = [];

  public increment(name: string, amount = 1n): void {
    this.counters.set(name, (this.counters.get(name) ?? 0n) + amount);
  }

  public observeLatency(milliseconds: number): void {
    this.latenciesMs.push(milliseconds);
    if (this.latenciesMs.length > 10_000) this.latenciesMs.splice(0, 1_000);
  }

  public percentile(percent: number): number {
    if (this.latenciesMs.length === 0) return 0;
    const sorted = [...this.latenciesMs].sort((left, right) => left - right);
    const index = Math.min(
      sorted.length - 1,
      Math.ceil(percent * sorted.length) - 1,
    );
    return sorted[Math.max(0, index)] ?? 0;
  }

  public prometheus(): string {
    const lines = [
      "# HELP xguard_requests_total Processed XGuard requests by outcome counter.",
      "# TYPE xguard_requests_total counter",
      ...[...this.counters.entries()].map(
        ([name, value]) => `xguard_${sanitize(name)} ${value.toString()}`,
      ),
      "# HELP xguard_added_latency_ms Additional XGuard coordinator latency.",
      "# TYPE xguard_added_latency_ms gauge",
      `xguard_added_latency_ms{quantile="0.50"} ${this.percentile(0.5).toFixed(3)}`,
      `xguard_added_latency_ms{quantile="0.95"} ${this.percentile(0.95).toFixed(3)}`,
      `xguard_added_latency_ms{quantile="0.99"} ${this.percentile(0.99).toFixed(3)}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:]/g, "_");
}
