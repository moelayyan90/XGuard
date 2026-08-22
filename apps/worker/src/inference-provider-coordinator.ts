import { DurableObject } from "cloudflare:workers";
import type {
  CoordinatorLease,
  CoordinatorApi,
  InferenceEnv,
} from "./inference-provider-types.js";

interface LeaseValue {
  expiresAt: number;
}

export class InferenceCoordinator
  extends DurableObject<InferenceEnv>
  implements CoordinatorApi
{
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: InferenceEnv) {
    super(state, env);
    this.state = state;
  }

  async acquire(
    maxConcurrency: number,
    ttlSeconds: number,
  ): Promise<CoordinatorLease> {
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const leases = await this.state.storage.list<LeaseValue>({
        prefix: "lease:",
      });
      const expired: string[] = [];
      let active = 0;
      for (const [key, value] of leases) {
        if (value.expiresAt <= now) expired.push(key);
        else active += 1;
      }
      if (expired.length > 0) await this.state.storage.delete(expired);
      if (active >= Math.max(1, maxConcurrency))
        return { acquired: false, retryAfterSeconds: 5 };
      const leaseId = crypto.randomUUID();
      await this.state.storage.put(`lease:${leaseId}`, {
        expiresAt: now + Math.max(30, ttlSeconds) * 1_000,
      });
      return { acquired: true, leaseId };
    });
  }

  async release(leaseId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/iu.test(leaseId)) return;
    await this.state.storage.delete(`lease:${leaseId}`);
  }
}
