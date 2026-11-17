import { actionFetch } from './gateway.js';
import { PAYPAL_CHECKOUT_PREVIEW_ORIGIN } from './paypal.js';

// Cloudflare Worker Previews provision separate Durable Object storage. This
// opt-in boundary exposes only checkout, never production services or secrets.
export async function checkoutPreviewFetch(request, env) {
  if (env.XGUARD_CHECKOUT_SANDBOX_PREVIEW !== 'on') return null;
  const url = new URL(request.url);
  const deny = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  if (env.PAYPAL_ENVIRONMENT !== 'sandbox' || url.origin !== PAYPAL_CHECKOUT_PREVIEW_ORIGIN) return deny('sandbox_preview_only', 503);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return deny('origin_not_allowed', 403);
  const headers = new Headers(request.headers);
  if (origin) headers.set('origin', 'https://xguardgate.com');
  const internal = new URL(request.url); internal.hostname = 'xguardgate.com';
  const response = await actionFetch(new Request(internal, { method: request.method, headers, body: request.body, redirect: 'manual', ...(request.body ? { duplex: 'half' } : {}) }), env);
  if (!response) return deny('sandbox_route_not_found', 404);
  const outputHeaders = new Headers(response.headers);
  outputHeaders.set('x-robots-tag', 'noindex, nofollow');
  outputHeaders.set('cache-control', 'private, no-store');
  if (origin) outputHeaders.set('access-control-allow-origin', origin);
  return new Response(response.body, { status: response.status, headers: outputHeaders });
}
