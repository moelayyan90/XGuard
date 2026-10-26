import http from 'node:http';
import { readFile } from 'node:fs/promises';

const BODY_LIMIT = 32 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(status, message) { throw new HttpError(status, message); }
function integer(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, `قيمة ${name} خارج النطاق المسموح.`);
  return value;
}
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'يجب إرسال كائن JSON.');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'يتضمن الطلب حقولًا غير مسموحة.');
  return value;
}
function boundedText(value, name, min, max, pattern) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || (pattern && !pattern.test(value))) {
    fail(400, `قيمة ${name} غير صالحة.`);
  }
  return value.trim();
}
function query(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail(400, 'معاملات الاستعلام غير صالحة.');
  }
}
function errorText(error) {
  return String(error?.message || 'تعذّر إتمام العملية.').slice(0, 1200)
    .replace(/\bBearer\s+\S+/gi, 'Bearer [محجوب]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[مفتاح محجوب]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[محجوب]');
}
function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  const code = String(error?.code || '').toLowerCase();
  if (code.includes('not_found')) return 404;
  if (code.includes('invalid')) return 400;
  if (/conflict|already|not_retryable|running/.test(code)) return 409;
  return 500;
}
async function body(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume(); fail(415, 'نوع المحتوى المطلوب application/json.');
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) {
    req.resume(); fail(413, 'يتجاوز الطلب الحجم المسموح وهو 32 KiB.');
  }
  const raw = await new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0; let settled = false;
    const timer = setTimeout(() => finish(new HttpError(408, 'انتهت مهلة استقبال الطلب.')), 10_000);
    timer.unref();
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { req.resume(); reject(error); } else resolve(result);
    }
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) return finish(new HttpError(413, 'يتجاوز الطلب الحجم المسموح وهو 32 KiB.'));
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.on('aborted', () => finish(new HttpError(400, 'انقطع إرسال الطلب.')));
    req.on('error', () => finish(new HttpError(400, 'تعذّر استقبال الطلب.')));
  });
  try { return JSON.parse(raw); } catch { fail(400, 'محتوى JSON غير صالح.'); }
}
function json(res, status, data, extra = {}) {
  res.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(data));
}
function list(result, kind, limit, offset, fallbackTotal) {
  const items = Array.isArray(result) ? result : result?.items ?? result?.[kind] ?? [];
  if (!Array.isArray(items)) throw new Error('قائمة النتائج غير صالحة.');
  const reported = result?.total ?? result?.totalCount ?? fallbackTotal;
  return { items, total: Number.isSafeInteger(reported) && reported >= 0 ? reported : null, limit, offset };
}

/** A local-only control surface. This module never provisions models or sends payments. */
export async function startServer({ store, runBatch, pause, port = 0, host = '127.0.0.1', modelHealth } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new TypeError('Fleet must bind to 127.0.0.1 or localhost only.');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid local port.');
  for (const method of ['stats', 'listAgents', 'listJobs', 'getJob', 'createJob', 'retry', 'agent']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`Missing store.${method}()`);
  }
  if (typeof runBatch !== 'function' || typeof pause !== 'function') throw new TypeError('runBatch and pause callbacks are required.');
  const assets = new Map(await Promise.all([...STATIC_FILES].map(async ([route, [file, type]]) =>
    [route, { bytes: await readFile(new URL(`./public/${file}`, import.meta.url)), type }])));
  const runner = { running: false, paused: false, startedAt: null, finishedAt: null, lastError: null, lastResult: null };
  let boundPort;
  const server = http.createServer(async (req, res) => {
    try {
      const validHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
      if (!validHosts.includes(req.headers.host)) { req.resume(); return json(res, 403, { error: 'عنوان الخادم المحلي غير مسموح.' }); }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) fail(400, 'عنوان الطلب غير صالح.');
      const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
      const path = url.pathname;
      const method = req.method;
      if (!['GET', 'HEAD', 'POST'].includes(method)) { req.resume(); return json(res, 405, { error: 'طريقة الطلب غير مسموحة.' }, { allow: 'GET, HEAD, POST' }); }
      if (method === 'POST') {
        const origin = req.headers.origin;
        const allowedOrigins = validHosts.map(value => `http://${value}`);
        if ((origin !== undefined && !allowedOrigins.includes(origin)) || ['cross-site', 'none'].includes(req.headers['sec-fetch-site'])) {
          req.resume(); return json(res, 403, { error: 'الطلبات الخارجية غير مسموحة.' });
        }
      }
      if (method === 'GET' && path === '/api/status') {
        query(url, []);
        return json(res, 200, { stats: await store.stats(), runner: { ...runner }, model: modelHealth ? await modelHealth() : null, revenue: { status: 'unproven', label: 'غير مثبت' } });
      }
      if (method === 'GET' && path === '/api/agents') {
        query(url, ['limit', 'offset', 'role']);
        const limit = integer(url.searchParams.get('limit'), 'حجم الصفحة', 1, 100, 25);
        const offset = integer(url.searchParams.get('offset'), 'موضع الصفحة', 0, 1_000_000, 0);
        const role = url.searchParams.has('role') ? boundedText(url.searchParams.get('role'), 'الدور', 1, 64, /^[A-Za-z0-9_-]+$/) : undefined;
        const result = await store.listAgents({ limit, offset, ...(role ? { role } : {}) });
        const stats = await store.stats();
        const total = role ? stats.roles?.[role] : typeof stats.agents === 'number' ? stats.agents : undefined;
        return json(res, 200, list(result, 'agents', limit, offset, total));
      }
      if (method === 'GET' && path === '/api/jobs') {
        query(url, ['limit', 'offset']);
        const limit = integer(url.searchParams.get('limit'), 'حجم الصفحة', 1, 100, 20);
        const offset = integer(url.searchParams.get('offset'), 'موضع الصفحة', 0, 1_000_000, 0);
        const stats = await store.stats();
        return json(res, 200, list(await store.listJobs({ limit, offset }), 'jobs', limit, offset, typeof stats.jobs === 'number' ? stats.jobs : undefined));
      }
      const jobRoute = path.match(/^\/api\/jobs\/([^/]+)(\/retry)?$/);
      if (jobRoute) {
        query(url, []);
        let id;
        try { id = decodeURIComponent(jobRoute[1]); } catch { fail(400, 'معرّف المهمة غير صالح.'); }
        boundedText(id, 'معرّف المهمة', 1, 128, /^[A-Za-z0-9_.:-]+$/);
        if (method === 'GET' && !jobRoute[2]) {
          const job = await store.getJob(id);
          if (!job) fail(404, 'المهمة غير موجودة.');
          return json(res, 200, { job });
        }
        if (method === 'POST' && jobRoute[2]) {
          object(await body(req), []);
          if (!await store.getJob(id)) fail(404, 'المهمة غير موجودة.');
          return json(res, 200, { job: await store.retry(id) });
        }
      }
      if (method === 'POST' && path === '/api/jobs') {
        query(url, []);
        const input = object(await body(req), ['agentId', 'instruction', 'idempotencyKey', 'maxSteps', 'maxOutputTokens']);
        const agentId = boundedText(input.agentId, 'الوكيل', 1, 100, /^[A-Za-z0-9_.:-]+$/);
        const instruction = boundedText(input.instruction, 'المهمة', 1, 12_000);
        const idempotencyKey = boundedText(input.idempotencyKey, 'مفتاح منع التكرار', 8, 128, /^[A-Za-z0-9_.:-]+$/);
        const maxSteps = integer(input.maxSteps, 'عدد الخطوات', 1, 8, 4);
        const maxOutputTokens = integer(input.maxOutputTokens, 'حجم الإجابة', 32, 1024, 256);
        if (!await store.agent(agentId)) fail(404, 'الوكيل غير موجود.');
        return json(res, 201, { job: await store.createJob({ agentId, instruction, idempotencyKey, maxSteps, maxOutputTokens }) });
      }
      if (method === 'POST' && path === '/api/run') {
        query(url, []);
        const input = object(await body(req), ['limit', 'concurrency']);
        const limit = integer(input.limit, 'حجم الدفعة', 1, 2000, 10);
        const concurrency = integer(input.concurrency, 'عدد المهام المتوازية', 1, 4, 2);
        if (runner.running) fail(409, 'هناك دفعة تعمل بالفعل.');
        runner.running = true; runner.paused = false; runner.startedAt = new Date().toISOString();
        runner.finishedAt = null; runner.lastError = null; runner.lastResult = null;
        json(res, 202, { accepted: true, runner: { ...runner } });
        setImmediate(() => {
          Promise.resolve().then(() => runBatch({ limit, concurrency })).then(result => {
            runner.lastResult = result ?? null;
            if (result?.schedulingPaused) runner.paused = true;
          }).catch(error => {
            runner.lastError = errorText(error);
          }).finally(() => {
            runner.running = false; runner.finishedAt = new Date().toISOString();
          });
        });
        return;
      }
      if (method === 'POST' && path === '/api/pause') {
        query(url, []);
        object(await body(req), []);
        await pause(); runner.paused = true;
        return json(res, 200, { paused: true, running: runner.running });
      }
      if ((method === 'GET' || method === 'HEAD') && assets.has(path)) {
        const asset = assets.get(path);
        res.writeHead(200, { ...HEADERS, 'content-type': asset.type, 'content-length': asset.bytes.length });
        res.end(method === 'HEAD' ? undefined : asset.bytes); return;
      }
      if (['/api/run', '/api/pause', '/api/jobs', '/api/agents', '/api/status'].includes(path) || jobRoute) {
        req.resume(); return json(res, 405, { error: 'طريقة الطلب غير مسموحة لهذا المسار.' });
      }
      req.resume(); return json(res, 404, { error: 'المسار غير موجود.' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, errorStatus(error), { error: errorText(error) });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => { server.off('error', reject); boundPort = server.address().port; resolve(); });
  });
  return {
    server,
    url: `http://127.0.0.1:${boundPort}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}
