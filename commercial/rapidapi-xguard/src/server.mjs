import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { extractUrl } from './extractor.mjs';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PROXY_SECRET = process.env.RAPIDAPI_PROXY_SECRET || '';
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

if (process.env.NODE_ENV === 'production' && !PROXY_SECRET) {
  throw new Error('RAPIDAPI_PROXY_SECRET is required when NODE_ENV=production');
}

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function secretMatches(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(String(received));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorize(request) {
  if (!PROXY_SECRET) return process.env.NODE_ENV !== 'production';
  return secretMatches(request.headers['x-rapidapi-proxy-secret'], PROXY_SECRET);
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON body must be an object');
  return value;
}

function publicError(error) {
  const message = String(error?.message || 'Extraction failed');
  if (/Only HTTP|credentials|blocked|Private|internal|URL/i.test(message)) return { status: 400, code: 'INVALID_URL', message };
  if (/body too large/i.test(message)) return { status: 413, code: 'REQUEST_TOO_LARGE', message };
  if (/exceeds .* bytes/i.test(message)) return { status: 422, code: 'UPSTREAM_TOO_LARGE', message };
  if (/content type/i.test(message)) return { status: 422, code: 'UNSUPPORTED_CONTENT', message };
  if (/HTTP \d+/i.test(message)) return { status: 502, code: 'UPSTREAM_HTTP_ERROR', message };
  if (/timeout|aborted/i.test(message)) return { status: 504, code: 'UPSTREAM_TIMEOUT', message: 'Upstream request timed out' };
  return { status: 502, code: 'EXTRACTION_FAILED', message: 'Unable to extract the requested page' };
}

const server = createServer(async (request, response) => {
  const method = request.method || 'GET';
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true, product: 'XGuard Web Extractor', version: '1.0.0' });
    return;
  }

  if (method !== 'POST' || url.pathname !== '/v1/extract') {
    json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { error: { code: 'UNAUTHORIZED_PROXY', message: 'Request did not originate from the configured RapidAPI proxy' } });
    return;
  }

  try {
    const body = await readJson(request);
    if (typeof body.url !== 'string' || body.url.length > 4096) {
      json(response, 400, { error: { code: 'INVALID_URL', message: 'url must be a valid string of at most 4096 characters' } });
      return;
    }

    const result = await extractUrl(body.url, {
      includeLinks: body.includeLinks !== false,
      maxContentChars: body.maxContentChars,
      timeoutMs: body.timeoutMs,
      maxHtmlBytes: body.maxHtmlBytes,
    });

    json(response, 200, {
      ok: true,
      result,
      billing: { provider: 'rapidapi', unit: 'successful_request' },
    });
  } catch (error) {
    const mapped = publicError(error);
    json(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
  }
});

server.requestTimeout = 65_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`XGuard Web Extractor listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
