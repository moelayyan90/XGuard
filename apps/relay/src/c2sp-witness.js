const te = new TextEncoder();

export const XGUARD_WITNESS_NAME = "xguardgate.com/witness";
export const PRODUCTION_WITNESS_KEY = "xguardgate.com/witness+4cbdcb41+BGR+T6u+czYHsxrFwXaOkfMFlzoAFNeHmYmSbwBlqY2Q";
export const MAX_PENDING_CHECKPOINTS = 16;
export const MAX_GROWTH_HISTORY = 32;
export const MAX_GROWTH_HISTORY_BYTES = 16384;
export const MAX_HEAD_RECORD_BYTES = 98304;
export const MAX_PROOF_LINES = 63;
export const MAX_REQUEST_BYTES = 131072;
export const EMPTY_TREE_ROOT = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

export const PINNED_LOGS = Object.freeze({
  "gblin.digital/receipts-log": Object.freeze({
    id: "gblin-receipts",
    origin: "gblin.digital/receipts-log",
    vkey: "gblin.digital/receipts-log+00c6e18c+AY8/YnCHXTnsECT2EGv0M5RTqlVvFobctLv3WSihYkoG",
    operator: "GBLIN Protocol",
    checkpoint: "https://mcp.gblin.digital/log/checkpoint",
  }),
});

const SIG_LINE = /^— ([^\s+]+) ([A-Za-z0-9+/=]+)$/u;

function cat(...parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function b64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unb64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function unb64url(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4 || 4)) % 4);
  return unb64(padded);
}

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function unhex(value) {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2) throw new Error("bad hex");
  return Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function eq(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function unb64Strict(value) {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("non-canonical base64");
  }
  let bytes;
  try {
    bytes = unb64(value);
  } catch {
    throw new Error("non-canonical base64");
  }
  if (b64(bytes) !== value) throw new Error("non-canonical base64");
  return bytes;
}

export function parseDecimal(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value)) throw new Error("bad decimal");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("decimal out of range");
  return parsed;
}

export function parseCheckpointNote(text) {
  if (typeof text !== "string" || !text.endsWith("\n")) throw new Error("note: missing final newline");
  if (/[\u0000-\u0009\u000b-\u001f]/.test(text)) throw new Error("note: control character");
  const separator = text.lastIndexOf("\n\n");
  if (separator < 0) throw new Error("note: no blank line");

  const body = text.slice(0, separator + 1);
  const signatureLines = text.length === separator + 2 ? [] : text.slice(separator + 2, -1).split("\n");
  for (const line of signatureLines) {
    const match = SIG_LINE.exec(line);
    if (!match) throw new Error("note: malformed signature line");
    if (unb64Strict(match[2]).length < 5) throw new Error("note: signature too short");
  }

  const lines = body.slice(0, -1).split("\n");
  if (lines.length < 3 || lines.some(line => line.length === 0)) {
    throw new Error("checkpoint: needs origin, size and root");
  }
  if (/[\s+]/u.test(lines[0]) || te.encode(lines[0]).length > 255) throw new Error("checkpoint: invalid origin");
  const size = parseDecimal(lines[1]);
  const root = unb64Strict(lines[2]);
  if (root.length !== 32) throw new Error("checkpoint: root hash is not 32 bytes");
  return { body, origin: lines[0], size, root, signatureLines };
}

export function parseVerifierKey(vkey) {
  const match = /^([^+]+)\+([0-9a-f]{8})\+([A-Za-z0-9+/=]+)$/.exec(String(vkey || ""));
  if (!match) throw new Error("bad verifier key");
  if (/[\s\u0000-\u001f]/u.test(match[1])) throw new Error("bad verifier key name");
  const raw = unb64Strict(match[3]);
  if (raw.length !== 33) throw new Error("bad verifier key payload");
  return { name: match[1], hash: unhex(match[2]), alg: raw[0], pub: raw.slice(1) };
}

async function keyHash(name, alg, pub) {
  return (await sha256(cat(te.encode(name + "\n"), Uint8Array.of(alg), pub))).slice(0, 4);
}

export async function verifyLogSignature(note, vkey) {
  const keyInfo = parseVerifierKey(vkey);
  if (keyInfo.alg !== 0x01) throw new Error("log key is not an Ed25519 note key");
  if (!eq(await keyHash(keyInfo.name, keyInfo.alg, keyInfo.pub), keyInfo.hash)) {
    throw new Error("verifier key hash mismatch");
  }
  const key = await crypto.subtle.importKey("raw", keyInfo.pub, { name: "Ed25519" }, false, ["verify"]);
  let verified = false;

  for (const line of new Set(note.signatureLines)) {
    const match = SIG_LINE.exec(line);
    if (!match || match[1] !== keyInfo.name) continue;
    const payload = unb64Strict(match[2]);
    if (!eq(payload.slice(0, 4), keyInfo.hash)) continue;
    if (payload.length !== 68) return false;
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, payload.slice(4), te.encode(note.body));
    if (!ok) return false;
    verified = true;
  }
  return verified;
}

const nodeHash = async (left, right) => sha256(cat(Uint8Array.of(0x01), left, right));
const isOdd = value => value % 2 === 1;
const half = value => Math.floor(value / 2);
const isPowerOfTwo = value => {
  if (value < 1) return false;
  let current = value;
  while (current % 2 === 0) current /= 2;
  return current === 1;
};

export async function verifyConsistency(oldSize, newSize, oldRoot, newRoot, proof) {
  if (oldSize === newSize) return proof.length === 0 && eq(oldRoot, newRoot);
  if (oldSize === 0) return proof.length === 0;
  if (oldSize > newSize || proof.length === 0) return false;

  let first = oldSize - 1;
  let second = newSize - 1;
  while (isOdd(first)) {
    first = half(first);
    second = half(second);
  }

  let index = 0;
  let oldHash;
  let newHash;
  if (isPowerOfTwo(oldSize)) {
    oldHash = oldRoot;
    newHash = oldRoot;
  } else {
    oldHash = proof[0];
    newHash = proof[0];
    index = 1;
  }

  for (; index < proof.length; index += 1) {
    if (second === 0) return false;
    const current = proof[index];
    if (isOdd(first) || first === second) {
      oldHash = await nodeHash(current, oldHash);
      newHash = await nodeHash(current, newHash);
      while (!isOdd(first) && first !== 0) {
        first = half(first);
        second = half(second);
      }
    } else {
      newHash = await nodeHash(newHash, current);
    }
    first = half(first);
    second = half(second);
  }

  return second === 0 && eq(oldHash, oldRoot) && eq(newHash, newRoot);
}

export async function originHashHex(origin) {
  return hex(await sha256(te.encode(origin)));
}

function reply(status, body, type = "text/plain; charset=utf-8", extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-xguard-c2sp": "v1",
      ...extra,
    },
  });
}

function json(body, status = 200) {
  return reply(status, JSON.stringify(body), "application/json; charset=utf-8");
}

async function witnessVerifierKey(publicRaw) {
  const hash = await keyHash(XGUARD_WITNESS_NAME, 0x04, publicRaw);
  return `${XGUARD_WITNESS_NAME}+${hex(hash)}+${b64(cat(Uint8Array.of(0x04), publicRaw))}`;
}

async function ensureWitnessKey(storage, expectedKey) {
  let record = await storage.get("witness:key:v1");
  if (record !== undefined) {
    // Never replace a damaged key record: that would silently change identity.
    const pub = unb64Strict(record?.publicRaw);
    if (pub.length !== 32 || record?.privateJwk?.kty !== "OKP" || record.privateJwk.crv !== "Ed25519" ||
        !record.privateJwk.d || !eq(unb64url(record.privateJwk.x), pub)) throw new Error("witness key unavailable");
    const privateKey = await crypto.subtle.importKey("jwk", record.privateJwk, { name: "Ed25519" }, false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    const check = te.encode("XGuard witness key integrity v1");
    const signature = await crypto.subtle.sign("Ed25519", privateKey, check);
    if (!await crypto.subtle.verify("Ed25519", publicKey, signature, check)) throw new Error("witness key unavailable");
    if (expectedKey && await witnessVerifierKey(pub) !== expectedKey) throw new Error("witness identity mismatch");
    return record;
  }

  // An existing production witness must be restored, never silently replaced.
  if (expectedKey) throw new Error("production witness key missing");

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicRaw = b64(unb64url(publicJwk.x));
  record = { privateJwk, publicRaw, createdAt: new Date().toISOString() };
  await storage.put("witness:key:v1", record);
  return record;
}

async function cosign(note, keyRecord, timestamp = Math.floor(Date.now() / 1000)) {
  const publicRaw = unb64Strict(keyRecord.publicRaw);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    keyRecord.privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const message = te.encode(`cosignature/v1\ntime ${timestamp}\n` + note.body);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message));
  const hash = await keyHash(XGUARD_WITNESS_NAME, 0x04, publicRaw);
  const timeBytes = new Uint8Array(8);
  new DataView(timeBytes.buffer).setBigUint64(0, BigInt(timestamp));
  return `— ${XGUARD_WITNESS_NAME} ${b64(cat(hash, timeBytes, signature))}`;
}

async function verifyPersistedCosignature(note, line, keyRecord) {
  const prefix = `— ${XGUARD_WITNESS_NAME} `;
  const wire = unb64Strict(line.slice(prefix.length)), publicRaw = unb64Strict(keyRecord.publicRaw);
  const hash = await keyHash(XGUARD_WITNESS_NAME, 0x04, publicRaw);
  if (wire.length !== 76 || !eq(wire.slice(0, 4), hash)) throw new Error("persisted witness signature invalid");
  const timestamp = new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getBigUint64(4);
  const key = await crypto.subtle.importKey("raw", publicRaw, { name: "Ed25519" }, false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, wire.slice(12), te.encode(`cosignature/v1\ntime ${timestamp}\n` + note.body))) throw new Error("persisted witness signature invalid");
}

function withCosignature(text, line) {
  const separator = text.lastIndexOf("\n\n");
  const signatures = text
    .slice(separator + 2, -1)
    .split("\n")
    .filter(existing => !existing.startsWith(`— ${XGUARD_WITNESS_NAME} `));
  return text.slice(0, separator + 2) + [...signatures, line].join("\n") + "\n";
}

function parseAddRequest(bodyText) {
  const separator = bodyText.indexOf("\n\n");
  if (separator < 0) throw new Error("no blank line before checkpoint");
  const prefix = bodyText.slice(0, separator).split("\n");
  const match = /^old (\S+)$/.exec(prefix[0] || "");
  const old = parseDecimal(match ? match[1] : "");
  const proofLines = prefix.slice(1);
  if (proofLines.length > MAX_PROOF_LINES) throw new Error("more than 63 proof lines");
  const proof = proofLines.map(line => {
    const hash = unb64Strict(line);
    if (hash.length !== 32) throw new Error("proof hash length");
    return hash;
  });
  const checkpointText = bodyText.slice(separator + 2);
  return { old, proof, checkpointText };
}

// The core takes an explicit trust policy so the external Go vectors can run
// unchanged in an isolated workerd. The production class below always pins it.
export class C2SPWitnessCore {
  constructor(state, logs, expectedKey) {
    this.state = state;
    this.logs = logs;
    this.expectedKey = expectedKey;
    this.pending = Promise.resolve();
    this.pendingCount = 0;
    this.activeRequests = 0;
    // Constructor input gate prevents concurrent first reads from generating
    // competing identities. Every operation reuses this single persisted key.
    this.keyReady = state.blockConcurrencyWhile(() => ensureWitnessKey(state.storage, expectedKey));
  }

  async metadata() {
    const key = await this.keyReady;
    const publicRaw = unb64Strict(key.publicRaw);
    const accepted = await Promise.all(Object.values(this.logs).map(async log => ({
      id: log.id,
      origin: log.origin,
      verifier_key: log.vkey,
      checkpoint: log.checkpoint,
      origin_hash: await originHashHex(log.origin),
    })));
    return {
      witness: XGUARD_WITNESS_NAME,
      protocol: "c2sp.org/tlog-witness",
      cosignature: "c2sp.org/tlog-cosignature v1 Ed25519",
      operator: "Mohammad Elayyan / XGuard",
      contact: "mo.elayyan2023@gmail.com",
      verifier_key: await witnessVerifierKey(publicRaw),
      push_endpoint: "https://api.xguardgate.com/witness/add-checkpoint",
      monitor_template: "https://api.xguardgate.com/witness/<sha256-origin>/checkpoint",
      status_template: "https://api.xguardgate.com/witness/<sha256-origin>/status",
      identity_policy: this.expectedKey ? "pinned_existing_production_key" : "ephemeral_local_fixture_key",
      limits: { pending_checkpoints: MAX_PENDING_CHECKPOINTS, growth_history: MAX_GROWTH_HISTORY, growth_history_bytes: MAX_GROWTH_HISTORY_BYTES, head_record_bytes: MAX_HEAD_RECORD_BYTES },
      accepted_logs: accepted,
      policy: "A cosignature only attests that the signed checkpoint verified and was consistent with the last checkpoint XGuard accepted for that origin.",
    };
  }

  addCheckpoint(bodyText) {
    if (this.pendingCount >= MAX_PENDING_CHECKPOINTS) return Promise.resolve(reply(429, "witness busy; retry the same checkpoint\n", "text/plain; charset=utf-8", { "retry-after": "1" }));
    this.pendingCount++;
    // An explicit queue also serializes requests that already entered before
    // an asynchronous signature verification completes. Storage commits before
    // the successful response and a failure cannot poison subsequent requests.
    const accepted = this.pending.then(() => this.acceptCheckpoint(bodyText)).finally(() => { this.pendingCount--; });
    this.pending = accepted.then(() => undefined, () => undefined);
    return accepted;
  }

  async acceptCheckpoint(bodyText) {
    const key = await this.keyReady;
    let request;
    try {
      request = parseAddRequest(bodyText);
    } catch (error) {
      return reply(400, `malformed request: ${error.message}\n`);
    }

    let note;
    try {
      note = parseCheckpointNote(request.checkpointText);
    } catch (error) {
      return reply(400, `malformed checkpoint: ${error.message}\n`);
    }

    const log = Object.hasOwn(this.logs, note.origin) ? this.logs[note.origin] : null;
    if (!log) return reply(404, "unknown origin\n");

    let signatureValid = false;
    try {
      signatureValid = await verifyLogSignature(note, log.vkey);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return reply(403, "checkpoint not signed by the pinned log key\n");
    if (request.old > note.size) return reply(400, "old size larger than checkpoint size\n");

    const headKey = `witness:head:${note.origin}`;
    const previous = await this.state.storage.get(headKey);
    if (this.expectedKey && !previous) throw new Error("production witness head missing");
    const held = previous?.size ?? 0;
    if (request.old !== held) return reply(409, `${held}\n`, "text/x.tlog.size");

    const root = b64(note.root);
    if (note.size === 0 && root !== EMPTY_TREE_ROOT) return reply(422, "size 0 requires the empty tree root\n");
    if (request.old === 0 && request.proof.length !== 0) return reply(422, "proof must be empty when old size is 0\n");

    if (request.old === note.size) {
      if (previous && previous.root !== root) return reply(422, "same size, different root\n");
      if (request.proof.length !== 0) return reply(422, "proof must be empty when old size equals checkpoint size\n");
      // Additional outside signature lines do not change the signed body.
      // Reusing an accepted response preserves its real timestamp and avoids
      // repeat storage writes. Incoming pinned-log authentication still ran.
      if (previous?.note && parseCheckpointNote(previous.note).body === note.body) {
        const priorLine = parseCheckpointNote(previous.note).signatureLines.find(line => line.startsWith(`— ${XGUARD_WITNESS_NAME} `));
        if (!priorLine) throw new Error("persisted witness signature missing");
        await verifyPersistedCosignature(note, priorLine, key);
        return reply(200, priorLine + "\n");
      }
    } else if (request.old > 0) {
      const oldRoot = unb64Strict(previous.root);
      const ok = await verifyConsistency(request.old, note.size, oldRoot, note.root, request.proof);
      if (!ok) return reply(422, "consistency proof invalid\n");
    }

    const line = await cosign(note, key);
    const cosignedNote = withCosignature(request.checkpointText, line);
    const updatedAt = new Date().toISOString();
    const history = [...(previous?.growthHistory || [])];
    const grew = previous && note.size > previous.size;
    if (grew) history.push({ old_size: previous.size, size: note.size, root, accepted_at: updatedAt, signed_body: note.body, cosignature: line });
    const record = {
      size: note.size,
      root,
      note: cosignedNote,
      updatedAt,
      growthHistory: history.slice(-MAX_GROWTH_HISTORY),
      growthEvents: (previous?.growthEvents || 0) + (grew ? 1 : 0),
      historyStartedAt: previous?.historyStartedAt || updatedAt,
    };
    while (record.growthHistory.length && (te.encode(JSON.stringify(record.growthHistory)).length > MAX_GROWTH_HISTORY_BYTES || te.encode(JSON.stringify(record)).length > MAX_HEAD_RECORD_BYTES)) record.growthHistory.shift();
    if (te.encode(JSON.stringify(record)).length > MAX_HEAD_RECORD_BYTES) return reply(413, "checkpoint exceeds witness storage budget\n");
    await this.state.storage.put(headKey, record);
    return reply(200, line + "\n");
  }

  async checkpointByHash(originHash) {
    for (const log of Object.values(this.logs)) {
      if (await originHashHex(log.origin) !== originHash) continue;
      const previous = await this.state.storage.get(`witness:head:${log.origin}`);
      if (this.expectedKey && !previous) throw new Error("production witness head missing");
      return previous?.note ? reply(200, previous.note) : reply(404, "no checkpoint cosigned yet\n");
    }
    return reply(404, "unknown origin\n");
  }

  async statusByHash(originHash) {
    for (const log of Object.values(this.logs)) {
      if (await originHashHex(log.origin) !== originHash) continue;
      const head = await this.state.storage.get(`witness:head:${log.origin}`);
      if (this.expectedKey && !head) throw new Error("production witness head missing");
      const metadata = await this.metadata();
      return json({ origin: log.origin, verifier_key: metadata.verifier_key, size: head?.size ?? null, root: head?.root ?? null,
        head_last_persisted_at: head?.updatedAt ?? null, history_started_at: head?.historyStartedAt ?? null,
        observed_growth_events: head?.growthEvents || 0, recent_growth: head?.growthHistory || [], storage_read: "ok",
        scope: "Bounded successful growth observed since instrumentation. Earlier sizes and failures are not reconstructed. A log signature authenticates the checkpoint, not its HTTP sender. Repeated same-body requests do not update the head." });
    }
    return reply(404, "unknown origin\n");
  }

  async fetch(request) {
    try {
      return await this.handleRequest(request);
    } catch {
      // No crypto/storage errors, key records, or exception details are public.
      return reply(503, "witness unavailable\n");
    }
  }

  async handleRequest(request) {
    await this.keyReady;
    const url = new URL(request.url);
    if (request.method === "GET" && ["/witness", "/witness/", "/witness/metadata"].includes(url.pathname)) {
      return json(await this.metadata());
    }
    if (request.method === "GET" && url.pathname === "/witness/verifier-key") {
      const key = await this.keyReady;
      return reply(200, (await witnessVerifierKey(unb64Strict(key.publicRaw))) + "\n");
    }
    if (request.method === "POST" && url.pathname === "/witness/add-checkpoint") {
      if (this.activeRequests >= MAX_PENDING_CHECKPOINTS) return reply(429, "witness busy; retry the same checkpoint\n", "text/plain; charset=utf-8", { "retry-after": "1" });
      this.activeRequests++;
      try {
        if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) return reply(413, "request too large\n");
        const chunks = [];
        let length = 0;
        const reader = request.body?.getReader();
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_REQUEST_BYTES) {
            await reader.cancel();
            return reply(413, "request too large\n");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        let body;
        try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { return reply(400, "malformed UTF-8\n"); }
        return await this.addCheckpoint(body);
      } finally { this.activeRequests--; }
    }
    const checkpoint = url.pathname.match(/^\/witness\/([0-9a-f]{64})\/checkpoint$/);
    if (request.method === "GET" && checkpoint) return this.checkpointByHash(checkpoint[1]);
    const status = url.pathname.match(/^\/witness\/([0-9a-f]{64})\/status$/);
    if (request.method === "GET" && status) return this.statusByHash(status[1]);
    return reply(404, "not found\n");
  }
}

export class C2SPWitness extends C2SPWitnessCore {
  constructor(state, env) {
    super(state, PINNED_LOGS, PRODUCTION_WITNESS_KEY);
  }
}

export async function c2spWitnessRoute(request, env) {
  const url = new URL(request.url);
  if (!["xguardgate.com", "api.xguardgate.com"].includes(url.hostname) || !url.pathname.startsWith("/witness")) return null;
  if (!["/witness", "/witness/", "/witness/metadata", "/witness/verifier-key", "/witness/add-checkpoint"].includes(url.pathname) && !/^\/witness\/[0-9a-f]{64}\/(?:checkpoint|status)$/.test(url.pathname)) return reply(404, "not found\n");
  if (!env.C2SP_WITNESS) return reply(503, "witness unavailable\n");
  if (!["GET", "POST", "HEAD"].includes(request.method)) return reply(405, "method not allowed\n", "text/plain; charset=utf-8", { allow: "GET, HEAD, POST" });

  const stub = env.C2SP_WITNESS.get(env.C2SP_WITNESS.idFromName("xguard-c2sp-witness-v1"));
  const forwarded = request.method === "HEAD"
    ? new Request(request.url, { method: "GET", headers: request.headers })
    : request;
  let response;
  try { response = await stub.fetch(forwarded); }
  catch { return reply(503, "witness unavailable\n"); }
  if (request.method !== "HEAD") return response;
  return new Response(null, { status: response.status, headers: response.headers });
}
