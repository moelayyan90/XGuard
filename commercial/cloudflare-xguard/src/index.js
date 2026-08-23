const PRODUCT = 'XGuard Web Extractor';
const VERSION = '1.0.0';
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

function isIpv4Literal(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isBlockedIpv6(host) {
  const h = host.toLowerCase();
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h) || h.startsWith('ff');
}

function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
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
  out += decoder.decode();
  return out;
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

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }
  return '';
}

function extractAttribute(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return tag.match(re)?.[1] || '';
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try {
    const u = assertPublicUrl(new URL(value, base).href);
    return u.href;
  } catch {
    return null;
  }
}

function extractLinks(html, base) {
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) && links.length < MAX_LINKS) {
    const url = absoluteUrl(match[1], base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: stripTags(match[2]).slice(0, 300) });
  }
  return links;
}

function htmlToMarkdown(html, maxChars) {
  let source = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|nav|footer|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, x) => `\n# ${stripTags(x)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, x) => `\n## ${stripTags(x)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, x) => `\n### ${stripTags(x)}\n`)
    .replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, x) => `\n#### ${stripTags(x)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, x) => `\n- ${stripTags(x)}`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, x) => `\n> ${stripTags(x)}\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, x) => `**${stripTags(x)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, x) => `_${stripTags(x)}_`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, x) => `\`${stripTags(x)}\``)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, x) => `\n${stripTags(x)}\n`)
    .replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_, x) => `\n${stripTags(x)}\n`);
  source = decodeEntities(source.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return source.slice(0, maxChars);
}

function extractPage(html, finalUrl, options) {
  const maxChars = clampInt(options.maxContentChars, DEFAULT_MAX_CONTENT_CHARS, 1_000, MAX_CONTENT_CHARS);
  const title = firstMatch(html, [/<title\b[^>]*>([\s\S]*?)<\/title>/i, /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i]);
  const description = firstMatch(html, [
    /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  ]);
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || '';
  const lang = extractAttribute(htmlTag, 'lang') || null;
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] || '';
  const canonical = absoluteUrl(extractAttribute(canonicalTag, 'href'), finalUrl);
  const markdown = htmlToMarkdown(html, maxChars);
  const text = stripTags(
    html
      .replace(/<(script|style|noscript|template|svg|canvas|iframe|nav|footer|form)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<(br|p|div|section|article|h1|h2|h3|h4|h5|h6|li)\b[^>]*>/gi, '\n'),
  ).slice(0, maxChars);
  return {
    url: finalUrl,
    title,
    description,
    lang,
    canonical,
    markdown,
    text,
    links: options.includeLinks === false ? [] : extractLinks(html, finalUrl),
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
  let body;
  try {
    body = JSON.parse(text || '{}');
  } catch {
    throw new Error('Request body must be valid JSON');
  }
  return body;
}

function authorized(request, env) {
  const configured = String(env.RAPIDAPI_PROXY_SECRET || '').trim();
  if (!configured) return true;
  const supplied = String(request.headers.get('x-rapidapi-proxy-secret') || '').trim();
  return supplied === configured;
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
        const result = extractPage(fetched.html, fetched.url, body);
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
