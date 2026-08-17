import { describe, expect, it } from "vitest";
import {
  autoInvokeResponse,
  autoRequestId,
  classifyAutoInvokeRoute,
  isAutoInvokeBillableStatus,
  isAutoInvokeRedirectStatus,
  decryptProviderCredential,
  encryptProviderCredential,
  rewrapProviderCredentialRecord,
} from "../apps/worker/src/auto-invoke.js";

const ORIGIN = "https://xguardgate.com";

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

  it("uses OpenAI X-Client-Request-Id as a fallback without overriding X-Request-Id", () => {
    const preferred = autoRequestId(
      new Request(ORIGIN, {
        headers: {
          "X-Request-Id": "xguard-primary-1234",
          "X-Client-Request-Id": "openai-client-5678",
        },
      }),
    );
    expect(preferred).toBe("xguard-primary-1234");

    const fallback = autoRequestId(
      new Request(ORIGIN, {
        headers: { "X-Client-Request-Id": "openai-client-5678" },
      }),
    );
    expect(fallback).toBe("openai-client-5678");
  });

  it("ignores malformed client request IDs and generates a UUID", () => {
    const generated = autoRequestId(
      new Request(ORIGIN, {
        headers: { "X-Client-Request-Id": "bad id" },
      }),
    );
    expect(generated).not.toBe("bad id");
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
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
    const body = JSON.stringify({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "hello" }],
    });
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
          "X-Api-Key": `xg_live_${"a".repeat(48)}`,
        },
        body,
      }),
    );
    expect(route).toMatchObject({
      provider: "gemini",
      upstreamUrl:
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    });
  });

  it("does not use an unauthenticated request body for Gemini inference", async () => {
    const body = JSON.stringify({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "hello" }],
    });
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
        },
        body,
      }),
    );
    expect(route).toMatchObject({
      provider: "openai",
      upstreamUrl: "https://api.openai.com/v1/chat/completions",
    });
  });

  it("bounds model inference when Content-Length is absent", async () => {
    const body = JSON.stringify({
      model: "gemini-3.6-flash",
      padding: "x".repeat(70 * 1024),
    });
    const request = new Request(`${ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": `xg_live_${"a".repeat(48)}`,
      },
      body,
    });
    expect(request.headers.get("content-length")).toBeNull();
    const route = await classifyAutoInvokeRoute(request);
    expect(route?.provider).toBe("openai");
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

  it("classifies provider redirects separately from billable success", () => {
    for (const status of [300, 301, 302, 303, 307, 308, 399])
      expect(isAutoInvokeRedirectStatus(status)).toBe(true);

    for (const status of [200, 204, 299, 400, 500])
      expect(isAutoInvokeRedirectStatus(status)).toBe(false);
  });

  it("rewraps provider credentials when the XGuard merchant key rotates", async () => {
    const oldToken = `xg_live_${"a".repeat(48)}`;
    const newToken = `xg_live_${"b".repeat(48)}`;
    const merchantId = "11111111-1111-4111-8111-111111111111";
    const encrypted = await encryptProviderCredential(
      "provider-secret-value",
      oldToken,
      merchantId,
      "openai",
    );
    const rewrapped = await rewrapProviderCredentialRecord({
      ...encrypted,
      oldMerchantToken: oldToken,
      newMerchantToken: newToken,
      merchantId,
      provider: "openai",
    });
    expect(
      await decryptProviderCredential(
        rewrapped.ciphertext,
        rewrapped.iv,
        newToken,
        merchantId,
        "openai",
      ),
    ).toBe("provider-secret-value");
    await expect(
      decryptProviderCredential(
        rewrapped.ciphertext,
        rewrapped.iv,
        oldToken,
        merchantId,
        "openai",
      ),
    ).rejects.toBeTruthy();
  });

  it("does not inspect oversized JSON for provider inference", async () => {
    const body = JSON.stringify({
      model: "gemini-3.6-flash",
      padding: "x".repeat(70 * 1024),
    });
    const route = await classifyAutoInvokeRoute(
      new Request(`${ORIGIN}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
        },
        body,
      }),
    );
    expect(route?.provider).toBe("openai");
  });

  it("does not intercept unrelated XGuard routes", async () => {
    expect(
      await autoInvokeResponse(new Request(`${ORIGIN}/status`), {
        DB: {} as D1Database,
      }),
    ).toBeNull();
  });
});
