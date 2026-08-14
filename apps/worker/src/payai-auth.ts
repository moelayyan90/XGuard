interface PayAIAuthEnvironment {
  PAYAI_API_KEY_ID?: string;
  PAYAI_API_KEY_SECRET?: string;
}

let cached:
  | { keyId: string; secretHash: string; token: string; refreshAfter: number }
  | undefined;

export async function payAIAuthHeader(
  env: PayAIAuthEnvironment,
): Promise<Record<string, string>> {
  const keyId = env.PAYAI_API_KEY_ID?.trim();
  const secret = env.PAYAI_API_KEY_SECRET?.trim();
  if (keyId === undefined && secret === undefined) return {};
  if (!keyId || !secret) throw new Error("payai_credentials_incomplete");

  const now = Math.floor(Date.now() / 1_000);
  const secretHash = await sha256(secret);
  if (
    cached !== undefined &&
    cached.keyId === keyId &&
    cached.secretHash === secretHash &&
    cached.refreshAfter > now
  )
    return { Authorization: `Bearer ${cached.token}` };

  const token = await generatePayAIJwt(keyId, secret, now);
  cached = { keyId, secretHash, token, refreshAfter: now + 90 };
  return { Authorization: `Bearer ${token}` };
}

async function generatePayAIJwt(
  keyId: string,
  rawSecret: string,
  now: number,
): Promise<string> {
  if (keyId.length < 2 || keyId.length > 256)
    throw new Error("payai_key_id_invalid");
  const normalized = rawSecret.startsWith("payai_sk_")
    ? rawSecret.slice("payai_sk_".length)
    : rawSecret;
  const keyBytes = decodeBase64(normalized);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const header = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: keyId }),
    ),
  );
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: keyId,
        iss: "payai-merchant",
        iat: now,
        exp: now + 120,
        jti: crypto.randomUUID(),
      }),
    ),
  );
  const message = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64Url(new Uint8Array(signature))}`;
}

function decodeBase64(value: string): ArrayBuffer {
  if (value.length < 16 || value.length > 8_192)
    throw new Error("payai_secret_invalid");
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new Error("payai_secret_invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
