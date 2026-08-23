const PRODUCT = 'XGuard Web Extractor';
const VERSION = '1.0.1';
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_HTML_BYTES = 5_000_000;
const DEFAULT_MAX_CONTENT_CHARS = 200_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_REDIRECTS = 5;
const MAX_LINKS = 200;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-rapidapi-proxy-secret,x-rapidapi-user',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isBlockedIpv4(value) {
  const p = value.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isIpv4Literal(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isBlockedIpv6(host) {
  const h = host.toLowerCase();
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h) || h.startsWith('ff');
}

function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' || host === 'localhost.localdomain' ||
    host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
    (isIpv4Literal(host) && isBlockedIpv4(host)) ||
    (host.includes(':') && isBlockedIpv6(host))
  ) throw new Error('Private, loopback, link-local, multicast, and internal destinations are blocked');
  return url;
}

async function resolveAndGuard(hostname) {
  if (isIpv4Literal(hostname) || hostname.includes(':')) return;
  const query = async (type) => {
    const endpoint = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await fetch(endpoint, { headers: { accept: 'application/dns-json' } });
    if (!response.ok) throw new Error('DNS validation failed');
    const payload = await response.json();
    return Array.isArray(payload.Answer) ? payload.Answer.map((x) => String(x.data || '')) : [];
  };
  const [aRecords, aaaaRecords] = await Promise.all([query('A'), query('AAAA')]);
  for (const address of aRecords) {
    if (isIpv4Literal(address) && isBlockedIpv4(address)) throw new Error('DNS resolved to a blocked IPv4 address');
  }
  for (const address of aaaaRecords) {
    if (address.includes(':') && isBlockedIpv6(address)) throw new Error('DNS resolved to a blocked IPv6 address');
  }
}

async function readTextCapped(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

async function fetchPublicHtml(rawUrl) {
  let current = assertPublicUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    current = assertPublicUrl(current.href);
    await resolveAndGuard(current.hostname);
    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': `XGuard-Web-Extractor/${VERSION} (+https://xguardgate.com)`,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect ${response.status} did not include Location`);
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects');
      current = assertPublicUrl(new URL(location, current).href);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
    }
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) throw new Error('Response body too large');
    return {
      html: await readTextCapped(response, MAX_HTML_BYTES),
      url: current.href,
      statusCode: response.status,
      contentType,
    };
  }
  throw new Error('Redirect processing failed');
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try { return assertPublicUrl(new URL(value, base).href).href; } catch { return null; }
}

async function extractPage(html, finalUrl, options) {
  const maxChars = clampInt(options.maxContentChars, DEFAULT_MAX_CONTENT_CHARS, 1_000, MAX_CONTENT_CHARS);
  const state = {
    title: [],
    description: '',
    lang: null,
    canonical: null,
    bodyText: [],
    links: [],
    seenLinks: new Set(),
  };

  const removeHandler = { element(element) { element.remove(); } };
  const rewriter = new HTMLRewriter()
    .on('script,style,noscript,template,svg,canvas,iframe,nav,footer,form', removeHandler)
    .on('html', {
      element(element) {
        const lang = element.getAttribute('lang');
        if (lang) state.lang = normalizeText(lang).slice(0, 64) || null;
      },
    })
    .on('title', {
      text(chunk) {
        if (chunk.text) state.title.push(chunk.text);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        if (!state.description) state.description = normalizeText(element.getAttribute('content') || '').slice(0, 2000);
      },
    })
    .on('meta[property="og:description"]', {
      element(element) {
        if (!state.description) state.description = normalizeText(element.getAttribute('content') || '').slice(0, 2000);
      },
    })
    .on('link[rel~="canonical"]', {
      element(element) {
        if (!state.canonical) state.canonical = absoluteUrl(element.getAttribute('href') || '', finalUrl);
      },
    })
    .on('a[href]', {
      element(element) {
        if (options.includeLinks === false || state.links.length >= MAX_LINKS) return;
        const href = absoluteUrl(element.getAttribute('href') || '', finalUrl);
        if (!href || state.seenLinks.has(href)) return;
        state.seenLinks.add(href);
        state.links.push({ url: href, text: '' });
      },
    })
    .on('body', {
      text(chunk) {
        if (chunk.text) state.bodyText.push(chunk.text);
      },
    });

  const transformed = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  await transformed.text();

  const text = normalizeText(state.bodyText.join(' ')).slice(0, maxChars);
  // Plain text is valid Markdown. Keeping the same normalized representation avoids
  // regex-based HTML sanitization while remaining deterministic for AI/RAG ingestion.
  const markdown = text;
  return {
    url: finalUrl,
    title: normalizeText(state.title.join(' ')).slice(0, 1000),
    description: state.description,
    lang: state.lang,
    canonical: state.canonical,
    markdown,
    text,
    links: state.links,
    contentLength: markdown.length,
    extractedAt: new Date().toISOString(),
    product: PRODUCT,
    version: VERSION,
    schemaVersion: 1,
  };
}

function openapi(origin) {
  return {
    openapi: '3.1.0',
    info: { title: PRODUCT, version: VERSION, description: 'Public web page extraction to Markdown, text, metadata and links.' },
    servers: [{ url: origin }],
    paths: {
      '/healthz': { get: { operationId: 'health', responses: { 200: { description: 'Healthy' } } } },
      '/v1/extract': {
        post: {
          operationId: 'extract',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    includeLinks: { type: 'boolean', default: true },
                    maxContentChars: { type: 'integer', minimum: 1000, maximum: MAX_CONTENT_CHARS, default: DEFAULT_MAX_CONTENT_CHARS },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Extraction result' },
            400: { description: 'Invalid request' },
            401: { description: 'RapidAPI proxy secret mismatch' },
            422: { description: 'Upstream extraction failed' },
          },
        },
      },
    },
  };
}

async function readJsonRequest(request) {
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('Request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error('Request body too large');
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Request body must be valid JSON'); }
}

function authorized(request, env) {
  const configured = String(env.RAPIDAPI_PROXY_SECRET || '').trim();
  if (!configured) return true;
  return String(request.headers.get('x-rapidapi-proxy-secret') || '').trim() === configured;
}

const landing = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Web Extractor</title><style>body{font-family:system-ui,sans-serif;max-width:850px;margin:64px auto;padding:0 20px;line-height:1.55;color:#111}code,pre{background:#f3f3f3;padding:3px 6px;border-radius:6px}pre{padding:16px;overflow:auto}h1{font-size:42px;margin-bottom:8px}.muted{color:#666}</style></head><body><h1>XGuard Web Extractor</h1><p class="muted">Production extraction origin for XGuard commercial integrations.</p><p><strong>Endpoint:</strong> <code>POST /v1/extract</code></p><pre>{"url":"https://example.com","includeLinks":true}</pre><p><a href="/openapi.json">OpenAPI 3.1</a> · <a href="/healthz">Health</a></p></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
    if (request.method === 'GET' && url.pathname === '/') return new Response(landing, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true, service: 'xguard-web-extractor', product: PRODUCT, version: VERSION, live: true });
    if (request.method === 'GET' && url.pathname === '/readyz') return json({ ready: true, service: 'xguard-web-extractor' });
    if (request.method === 'GET' && url.pathname === '/openapi.json') return json(openapi(url.origin));
    if (request.method === 'POST' && url.pathname === '/v1/extract') {
      if (!authorized(request, env)) return json({ error: 'unauthorized', message: 'RapidAPI proxy secret mismatch' }, 401);
      try {
        const body = await readJsonRequest(request);
        if (typeof body.url !== 'string' || !body.url.trim()) return json({ error: 'invalid_request', message: 'url is required' }, 400);
        const requested = assertPublicUrl(body.url.trim());
        const fetched = await fetchPublicHtml(requested.href);
        const result = await extractPage(fetched.html, fetched.url, body);
        if (!result.markdown && !result.text) return json({ error: 'empty_result', message: 'No extractable text content found' }, 422);
        return json({ ...result, statusCode: fetched.statusCode, contentType: fetched.contentType });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Extraction failed';
        const status = /Invalid URL|Only HTTP|credentials|Private|blocked|Request body|valid JSON/.test(message) ? 400 : 422;
        return json({ error: status === 400 ? 'invalid_request' : 'extraction_failed', message }, status);
      }
    }
    return json({ error: 'not_found' }, 404);
  },
};
