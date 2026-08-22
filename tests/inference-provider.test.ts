import { describe, expect, it } from "vitest";
import {
  chatCompletionSchema,
  decimalUsdToMicro,
  estimateTokens,
  microUsd,
  routeCostBreakdown,
  timingSafeSecret,
  tokenCost,
} from "../apps/worker/src/inference-provider-types.js";

describe("inference provider economic primitives", () => {
  it("uses integer micro-USD token accounting", () => {
    expect(tokenCost(1_000, 2_000, 500_000, 800_000)).toBe(2_100);
    expect(decimalUsdToMicro("0.000001", 0)).toBe(1);
    expect(decimalUsdToMicro("350", 0)).toBe(350_000_000);
    expect(microUsd(2_100)).toBe("0.0021");
    expect(microUsd(-2)).toBe("-0.000002");
    expect(
      routeCostBreakdown(
        {
          XGUARD_NETWORK_FEE_PERCENT: "5",
          XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST: "1",
        } as never,
        9,
        2,
      ),
    ).toEqual({
      upstreamMicroUsd: 2,
      networkMicroUsd: 1,
      variableInfraMicroUsd: 1,
      totalMicroUsd: 4,
    });
    expect(routeCostBreakdown({} as never, 9, 2)).toBeNull();
  });

  it("validates the OpenAI-compatible chat envelope without retaining prompts", () => {
    const parsed = chatCompletionSchema.parse({
      model: "xguard/qwen3-8b",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 64,
      stream: true,
      temperature: 0.2,
    });
    expect(parsed.stream).toBe(true);
    expect(parsed.temperature).toBe(0.2);
    expect(estimateTokens(parsed).maximumCompletionTokens).toBe(64);
  });

  it("compares credentials through digests", async () => {
    await expect(
      timingSafeSecret("network-secret-0001", "network-secret-0001"),
    ).resolves.toBe(true);
    await expect(
      timingSafeSecret("network-secret-0002", "network-secret-0001"),
    ).resolves.toBe(false);
    await expect(timingSafeSecret(null, "network-secret-0001")).resolves.toBe(
      false,
    );
  });
});
