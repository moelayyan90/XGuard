import { describe, expect, it } from "vitest";
import {
  autoInvokeResponse,
  classifyAutoInvokeRoute,
  isAutoInvokeBillableStatus,
  decryptProviderCredential,
  encryptProviderCredential,
} from "../apps/worker/src/auto-invoke.js";

const ORIGIN = "https://xguard-mainnet.maqamapp.workers.dev";

describe("XGuard zero-study auto invoke", () => {
  it("publishes machine-readable configure-once discovery", async () => {
    const response = await autoInvokeResponse(
      new Request(`${ORIGIN}/.well-known/xguard.json`),
      { DB: {} as D1Database, XGUARD_MODEL_FEE_MICRO_USD: "10" },
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      mode: string;
      standardClients: Record<string, unknown>;
      xguardSpecificHeaderRequiredPerRequest: boolean;
    };
    expect(body.mode).toBe("zero-study-auto-invoke");
    expect(body.standardClients).toHaveProperty("openai");
    expect(body.standardClients).toHaveProperty("anthropic");
    expect(body.xguardSpecificHeaderRequiredPerRequest).toBe(false);
  });

  it("infers OpenAI from standard OpenAI-compatible requests", async () => {
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5", input: "hello" }),
      }),
    );
    expect(route).toMatchObject({
      provider: "openai",
      upstreamUrl: "https://api.openai.com/v1/responses",
    });
  });

  it("infers Gemini automatically from the model name", async () => {
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3.6-flash",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    expect(route).toMatchObject({
      provider: "gemini",
      upstreamUrl:
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    });
  });

  it("recognizes Anthropic native SDK traffic without an XGuard-specific route", async () => {
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4",
          max_tokens: 64,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    expect(route).toMatchObject({
      provider: "anthropic",
      upstreamUrl: "https://api.anthropic.com/v1/messages",
    });
  });

  it("encrypts linked provider credentials and decrypts only with the same merchant token", async () => {
    const token = `xg_live_${"a".repeat(48)}`;
    const merchantId = "11111111-1111-4111-8111-111111111111";
    const encrypted = await encryptProviderCredential(
      "provider-secret-value",
      token,
      merchantId,
      "openai",
    );
    expect(encrypted.ciphertext).not.toContain("provider-secret-value");
    expect(
      await decryptProviderCredential(
        encrypted.ciphertext,
        encrypted.iv,
        token,
        merchantId,
        "openai",
      ),
    ).toBe("provider-secret-value");
    await expect(
      decryptProviderCredential(
        encrypted.ciphertext,
        encrypted.iv,
        `${token}wrong`,
        merchantId,
        "openai",
      ),
    ).rejects.toBeTruthy();
  });

  it("bills only 2xx auto-invoke provider responses", () => {
    for (const status of [200, 201, 204, 299])
      expect(isAutoInvokeBillableStatus(status)).toBe(true);

    for (const status of [199, 300, 301, 302, 307, 308, 399, 400, 429, 500])
      expect(isAutoInvokeBillableStatus(status)).toBe(false);
  });

  it("does not intercept unrelated XGuard routes", async () => {
    expect(
      await autoInvokeResponse(new Request(`${ORIGIN}/status`), {
        DB: {} as D1Database,
      }),
    ).toBeNull();
  });
});
