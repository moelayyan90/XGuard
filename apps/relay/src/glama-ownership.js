import { securityHeaders } from './live/security.ts';
import ownership from '../../../.well-known/glama.json' with { type: 'json' };

export const GLAMA_SCHEMA = 'https://glama.ai/mcp/schemas/connector.json';
export const GLAMA_PROOF_PATHS = ['/.well-known/glama.json', '/mcp/.well-known/glama.json'];
export const GLAMA_ORIGINS = ['https://xguardgate.com', 'https://api.xguardgate.com'];
export const GLAMA_OWNERSHIP = ownership;

// This checks the official format only. Acceptance and account ownership must
// still be confirmed in Glama. Never generate a token here or use an email.
export function validGlamaClaim(value) {
  return typeof value === 'string' && /^glama_claim_[A-Za-z0-9_-]{32}$/.test(value);
}

export function requireGlamaClaim(value) {
  if (!validGlamaClaim(value)) throw new Error('An owner-issued GLAMA_CLAIM_TOKEN is required. Copy the exact token from the signed-in Glama claim panel; no proof was published.');
  return value;
}

export function glamaOwnershipFetch(request, env = {}, proof = ownership) {
  const url = new URL(request.url);
  if (!GLAMA_ORIGINS.includes(url.origin) || !GLAMA_PROOF_PATHS.includes(url.pathname)) return null;
  const headers = new Headers({ ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'cache-control': 'no-store',
    'x-xguard-discovery': 'glama',
  });
  if (env.CF_VERSION_METADATA?.id) headers.set('x-xguard-worker-version-id', env.CF_VERSION_METADATA.id);
  if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('allow', 'GET, HEAD, OPTIONS');
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
  }
  const configured = proof?.$schema === GLAMA_SCHEMA && validGlamaClaim(proof?.claim);
  if (configured) headers.set('cache-control', 'public, max-age=300, must-revalidate');
  else headers.set('retry-after', '300');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(configured
    ? { $schema: GLAMA_SCHEMA, claim: proof.claim }
    : { error: 'glama_claim_not_configured' }), { status: configured ? 200 : 503, headers });
}
