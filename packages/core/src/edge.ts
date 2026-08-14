export * from "./canonical.js";
export * from "./errors.js";
export * from "./money.js";
export * from "./safety.js";
export * from "./state-machine.js";

import { XGuardError } from "./errors.js";

export interface HttpBodySource {
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
}

/**
 * Reads a small HTTP body without ever buffering more than `maximumBytes`.
 *
 * Content-Length is only an early rejection optimization; the streaming byte
 * counter remains authoritative for chunked bodies and dishonest senders.
 */
export async function readHttpBodyTextCapped(
  source: HttpBodySource,
  maximumBytes: number,
  label = "HTTP body",
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new RangeError("maximumBytes must be a non-negative safe integer");

  const declaredLength = source.headers.get("content-length");
  if (declaredLength !== null) {
    const normalized = declaredLength.trim();
    if (!/^[0-9]+$/.test(normalized))
      throw new XGuardError(
        "BAD_REQUEST",
        `${label} has an invalid Content-Length`,
        400,
      );
    if (BigInt(normalized) > BigInt(maximumBytes))
      throw bodyTooLarge(label, maximumBytes);
  }

  if (source.body === null) return "";
  const reader = source.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytesRead += next.value.byteLength;
      if (bytesRead > maximumBytes) throw bodyTooLarge(label, maximumBytes);
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TypeError)
      throw new XGuardError("BAD_REQUEST", `${label} is not valid UTF-8`, 400);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function bodyTooLarge(label: string, maximumBytes: number): XGuardError {
  return new XGuardError(
    "BAD_REQUEST",
    `${label} exceeds ${maximumBytes} bytes`,
    413,
  );
}
