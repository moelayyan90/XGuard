import { DurableObject } from "cloudflare:workers";

interface RateWindow {
  windowStartMs: number;
  used: number;
}

export interface XPayRateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
}

export class XPayGlobalRateGate extends DurableObject {
  public async take(
    nowMs: number,
    limit: number,
    windowMs = 60_000,
  ): Promise<XPayRateDecision> {
    validateArguments(nowMs, limit, windowMs);
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const resetAtMs = windowStartMs + windowMs;
    const current = await this.ctx.storage.get<RateWindow>("rate-window");
    const state: RateWindow =
      current === undefined || current.windowStartMs !== windowStartMs
        ? { windowStartMs, used: 0 }
        : current;

    if (state.used >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
        resetAtMs,
      };
    }

    state.used += 1;
    await this.ctx.storage.put("rate-window", state);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - state.used),
      retryAfterSeconds: 0,
      resetAtMs,
    };
  }

  public async refund(nowMs: number, windowMs = 60_000): Promise<void> {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return;
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) return;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const current = await this.ctx.storage.get<RateWindow>("rate-window");
    if (
      current === undefined ||
      current.windowStartMs !== windowStartMs ||
      current.used <= 0
    )
      return;
    await this.ctx.storage.put("rate-window", {
      windowStartMs,
      used: current.used - 1,
    } satisfies RateWindow);
  }
}

function validateArguments(nowMs: number, limit: number, windowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0)
    throw new Error("invalid_rate_clock");
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000)
    throw new Error("invalid_rate_limit");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 60_000)
    throw new Error("invalid_rate_window");
}
