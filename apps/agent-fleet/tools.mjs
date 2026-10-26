import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { constants, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

export class ToolError extends Error {
  constructor(code, message = code, { blocked = true } = {}) {
    super(message); this.name = 'ToolError'; this.code = code; this.blocked = blocked;
  }
}
const fail = (code, message) => { throw new ToolError(code, message); };
const sha256 = data => createHash('sha256').update(data).digest('hex');

function noSymlinks(path) {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail('unsafe_path', 'Symbolic links are not allowed in the artifact workspace');
  }
}

function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

function pinnedGet(url, address, signal) {
  return new Promise((resolveResponse, reject) => {
    const req = request(url, { method: 'GET', signal, timeout: 10000,
      headers: { accept: 'application/json,text/plain,text/html', 'user-agent': 'XGuardAgentFleet/1.0 (public read-only research)' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, response => {
      const chunks = []; let size = 0;
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.destroy(); req.destroy(); reject(new ToolError('redirect_blocked', 'Web redirects are disabled')); return;
      }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 262144) req.destroy(new ToolError('web_response_too_large', 'Web response exceeded 256 KiB'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolveResponse({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new ToolError('web_timeout', 'Web request timed out')));
    req.on('error', reject); req.end();
  });
}

export class FleetTools {
  constructor({ root, allowedDomains = [], fetchImpl, lookupImpl = lookup, maxWebCallsPerDay = 100 } = {}) {
    if (typeof root !== 'string' || !root.trim()) fail('invalid_workspace', 'A dedicated artifact directory is required');
    if (!Array.isArray(allowedDomains) || allowedDomains.length > 100 || allowedDomains.some(d => typeof d !== 'string' || !/^(?=.{4,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(d) || isIP(d))) fail('invalid_domains', 'Use exact public DNS host names');
    if (!Number.isInteger(maxWebCallsPerDay) || maxWebCallsPerDay < 0 || maxWebCallsPerDay > 100) fail('invalid_web_budget');
    this.root = resolve(root); noSymlinks(this.root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 }); chmodSync(this.root, 0o700);
    this.root = realpathSync(this.root); this.domains = new Set(allowedDomains.map(d => d.toLowerCase()));
    this.fetchImpl = fetchImpl; this.lookupImpl = lookupImpl; this.maxWebCallsPerDay = maxWebCallsPerDay;
    this.cache = new Map(); this.inflight = new Map();
    const path = join(this.root, 'tool-usage.sqlite');
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('unsafe_path');
    if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
    chmodSync(path, 0o600); this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS web_usage(day TEXT PRIMARY KEY,calls INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS job_usage(job_id TEXT PRIMARY KEY,calls INTEGER NOT NULL);');
  }
  close() { this.db.close(); }
  pathFor(jobId, path) {
    if (typeof jobId !== 'string' || !/^job-[a-zA-Z0-9-]{1,80}$/.test(jobId)) fail('unsafe_job_id');
    if (typeof path !== 'string' || !path.length || path.length > 240 || /[\\\0:]/.test(path) || path.startsWith('/')) fail('unsafe_path');
    const parts = path.split('/');
    if (parts.length > 5 || parts.some(p => !p || p.startsWith('.') || p.length > 100)) fail('unsafe_path');
    const base = join(this.root, jobId), target = join(base, ...parts);
    noSymlinks(target); return { base, target };
  }
  async execute(action, { jobId, agentId, allowedTools = [], signal } = {}) {
    if (typeof agentId !== 'string' || !/^agent-\d{6}$/.test(agentId)) fail('invalid_agent');
    if (!action || typeof action !== 'object' || !Array.isArray(allowedTools) || !allowedTools.includes(action.action)) fail('tool_not_allowed', 'The agent is not authorized to use this tool');
    if (signal?.aborted) fail('cancelled');
    if (action.action === 'write_file') {
      const { target } = this.pathFor(jobId, action.path);
      if (typeof action.content !== 'string' || Buffer.byteLength(action.content) > 65536) fail('artifact_too_large');
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); noSymlinks(target);
      const data = Buffer.from(action.content);
      if (existsSync(target)) {
        if (!lstatSync(target).isFile() || sha256(await readFile(target)) !== sha256(data)) fail('artifact_conflict', 'Existing artifacts cannot be silently overwritten');
        return { path: action.path, bytes: data.length, sha256: sha256(data), reused: true };
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        try { await link(temporary, target); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          noSymlinks(target);
          if (!lstatSync(target).isFile() || sha256(await readFile(target)) !== sha256(data)) fail('artifact_conflict', 'A competing write produced different content');
        }
      } finally { await unlink(temporary).catch(() => {}); }
      return { path: action.path, bytes: data.length, sha256: sha256(data) };
    }
    if (action.action === 'read_file') {
      const { target } = this.pathFor(jobId, action.path); noSymlinks(target);
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 65536) fail('unsafe_artifact', 'Expected a regular artifact of at most 64 KiB');
        const content = await file.readFile('utf8');
        return { path: action.path, content, sha256: sha256(content) };
      } finally { await file.close(); }
    }
    if (action.action === 'web_get') return this.webGet(action.url, jobId, signal);
    fail('unknown_tool');
  }
  async webGet(value, jobId, signal) {
    let url;
    try { url = new URL(value); } catch { fail('invalid_web_url'); }
    if (!/^job-[a-zA-Z0-9-]{1,80}$/.test(jobId)) fail('unsafe_job_id');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !this.domains.has(url.hostname.toLowerCase()) || isIP(url.hostname) ||
        [...url.searchParams.keys()].some(k => /token|secret|password|authorization|api.?key/i.test(k))) fail('web_domain_not_allowed', 'Web reads require an exact allowed public HTTPS domain without credentials');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('SELECT calls FROM job_usage WHERE job_id=?').get(jobId)?.calls ?? 0;
      if (used >= 3) fail('job_web_limit', 'A job may perform at most three web reads');
      this.db.prepare('INSERT INTO job_usage(job_id,calls) VALUES(?,1) ON CONFLICT(job_id) DO UPDATE SET calls=calls+1').run(jobId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const key = url.href, cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = this.fetchPublic(url, signal).then(result => { this.cache.set(key, { expires: Date.now() + 600000, value: result }); return result; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending); return pending;
  }
  async fetchPublic(url, signal) {
    const day = new Date().toISOString().slice(0, 10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('SELECT calls FROM web_usage WHERE day=?').get(day)?.calls ?? 0;
      if (used >= this.maxWebCallsPerDay) fail('daily_web_limit', 'The daily web-read budget is exhausted');
      this.db.prepare('INSERT INTO web_usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const addresses = await this.lookupImpl(url.hostname, { family: 4, all: true });
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(x => !publicIPv4(x.address))) fail('private_network_blocked', 'Web destinations must resolve exclusively to public IPv4 addresses');
    const timeout = AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]);
    let result;
    if (this.fetchImpl) {
      const response = await this.fetchImpl(url.href, { method: 'GET', redirect: 'error', signal: timeout });
      if (response.status >= 300 && response.status < 400) fail('redirect_blocked');
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength; if (size > 262144) fail('web_response_too_large'); chunks.push(Buffer.from(chunk));
      }
      result = { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
    } else result = await pinnedGet(url, addresses[0].address, timeout);
    return { url: url.href, status: result.status, text: result.text.slice(0, 32768), sha256: sha256(result.text), untrusted: true };
  }
}
