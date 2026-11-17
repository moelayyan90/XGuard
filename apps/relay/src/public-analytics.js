// Cloudflare injects the existing site's beacon at the edge. Do not inject a
// second beacon or send checkout inputs/recovery pages to browser analytics.
const SCRIPT = 'https://static.cloudflareinsights.com';
const COLLECTOR = 'https://cloudflareinsights.com';
const PRIVATE = /^\/(?:admin|checkout|dashboard|api|v1|_legacy)(?:\/|$)/;

export function publicAnalyticsResponse(request, response) {
  const url = new URL(request.url);
  if (url.hostname !== 'xguardgate.com' || !['GET', 'HEAD'].includes(request.method)
      || response.status !== 200 || PRIVATE.test(url.pathname)
      || /noindex/i.test(response.headers.get('x-robots-tag') || '')
      || !response.headers.get('content-type')?.startsWith('text/html')) return response;
  const policy = response.headers.get('content-security-policy');
  if (!policy) return response;
  const directives = new Map(policy.split(';').map(part => part.trim().split(/\s+/)).filter(part => part[0]).map(([name, ...values]) => [name, values]));
  function allow(name, source, fallback = []) {
    const current = directives.get(name) || fallback;
    directives.set(name, [...new Set([...current.filter(x => x !== "'none'"), source])]);
  }
  allow('script-src', SCRIPT, directives.get('default-src'));
  if (directives.has('script-src-elem')) allow('script-src-elem', SCRIPT);
  allow('connect-src', "'self'", directives.get('default-src'));
  allow('connect-src', COLLECTOR);
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', [...directives].map(([name, values]) => [name, ...values].join(' ')).join('; '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
