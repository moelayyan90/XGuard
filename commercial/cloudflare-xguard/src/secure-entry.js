import worker from './safe-index.js';

function isBlockedIpv4Octets([a, b, c, d]) {
  if (![a, b, c, d].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function mappedIpv4Octets(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  const marker = host.lastIndexOf('ffff:');
  if (marker < 0) return null;
  const prefix = host.slice(0, marker);
  if (!(prefix === '::' || /^0(?::0){0,4}:$/.test(prefix))) return null;
  const tail = host.slice(marker + 5);

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail.split('.').map(Number);

  const groups = tail.split(':');
  if (groups.length !== 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255];
}

function blocksMappedPrivate(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const octets = mappedIpv4Octets(url.hostname);
    return octets ? isBlockedIpv4Octets(octets) : false;
  } catch {
    return false;
  }
}

function blockedResponse() {
  return new Response(
    JSON.stringify({
      error: 'invalid_request',
      message: 'IPv4-mapped IPv6 destinations resolving to private, loopback, link-local, multicast, or reserved IPv4 space are blocked',
    }),
    {
      status: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    },
  );
}

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    if (request.method === 'POST' && requestUrl.pathname === '/v1/extract') {
      try {
        const copy = request.clone();
        const body = await copy.json();
        if (typeof body?.url === 'string' && blocksMappedPrivate(body.url)) return blockedResponse();
      } catch {
        // The primary handler owns JSON and request-size validation.
      }
    }
    return worker.fetch(request, env, ctx);
  },
};
