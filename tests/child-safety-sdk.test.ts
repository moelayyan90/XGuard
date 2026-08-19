import { describe, expect, it, vi } from "vitest";
import {
  createChildSafetyClient,
  type ChildSafetyScanResult,
} from "../packages/sdk/src/child-safety.js";

const API_KEY = `xg_live_${"a".repeat(48)}`;

function criticalResult(): ChildSafetyScanResult {
  return {
    eventId: "event-12345678",
    contentKind: "message",
    riskLevel: "CRITICAL",
    confidence: 0.98,
    categories: ["grooming", "coercion_or_sextortion"],
    primaryAction: "FREEZE_CHAT",
    enforcement: {
      blockContent: true,
      freezeConversation: true,
      preventFurtherContact: true,
      requireHumanSafetyReview: true,
      surfaceReportFlow: true,
      preserveClientSideEvidence: true,
    },
    feeUsd: "0.005",
    rawContentStored: false,
  };
}

describe("child safety SDK", () => {
  it("sends a paid server-side scan request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(criticalResult()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createChildSafetyClient({
      url: "https://xguardgate.com",
      apiKey: API_KEY,
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.scan({
      eventId: "event-12345678",
      riskSessionId: "session-12345678",
      contentKind: "message",
      childLikely: true,
      text: "test safety input",
    });

    expect(result.primaryAction).toBe("FREEZE_CHAT");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
  });

  it("turns a critical decision into host enforcement hooks", async () => {
    const client = createChildSafetyClient({
      url: "https://xguardgate.com",
      apiKey: API_KEY,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const onBlock = vi.fn();
    const onFreezeConversation = vi.fn();
    const onPreventFurtherContact = vi.fn();
    const onHumanReview = vi.fn();
    const onReportFlow = vi.fn();
    const onPreserveEvidence = vi.fn();

    await client.enforce(criticalResult(), {
      onBlock,
      onFreezeConversation,
      onPreventFurtherContact,
      onHumanReview,
      onReportFlow,
      onPreserveEvidence,
    });

    expect(onBlock).toHaveBeenCalledOnce();
    expect(onFreezeConversation).toHaveBeenCalledOnce();
    expect(onPreventFurtherContact).toHaveBeenCalledOnce();
    expect(onHumanReview).toHaveBeenCalledOnce();
    expect(onReportFlow).toHaveBeenCalledOnce();
    expect(onPreserveEvidence).toHaveBeenCalledOnce();
  });
});
