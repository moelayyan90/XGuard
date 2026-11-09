import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPublicKey, verify } from 'node:crypto';
// A second implementation: Node's verifier, no XGuard server, SDK or runtime
// dependency. The caller supplies a separately pinned public key.
export function verifyReceiptOffline(jws, pinnedKey) {
  try {
    if (typeof jws !== 'string' || jws.length > 8192) return { valid: false };
    const [head, body, signature, extra] = jws.split('.');
    if (extra || ![head, body, signature].every(x => /^[A-Za-z0-9_-]+$/.test(x))) return { valid: false };
    const header = JSON.parse(Buffer.from(head, 'base64url')), payload = JSON.parse(Buffer.from(body, 'base64url'));
    if (header.alg !== 'ES256' || header.typ !== 'xguard-afa-receipt+jws' || Object.keys(header).some(k => !['alg','typ','kid'].includes(k)) || payload.protocol !== 'xguard-afa-receipt/1') return { valid: false };
    const key = createPublicKey({ key: pinnedKey, format: 'jwk' });
    const valid = verify('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    return { valid, ...(valid ? { payload } : {}), settlement_finality_verified: false };
  } catch { return { valid: false }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [receiptPath, keyPath] = process.argv.slice(2);
  if (!receiptPath || !keyPath) throw Error('Usage: node sdk/financial-authority/verify-receipt.mjs receipt.json pinned-public-key.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')), key = JSON.parse(await readFile(keyPath, 'utf8'));
  const result = verifyReceiptOffline(receipt.jws || receipt.receipt?.jws, key.jwk || key);
  console.log(JSON.stringify(result)); if (!result.valid) process.exitCode = 1;
}
