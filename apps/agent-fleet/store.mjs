import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_BYTES = 32768;
const MAX_ATTEMPTS = 3;
const TOOLS = new Set(['write_file', 'read_file', 'web_get']);
const validObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class FleetError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'FleetError';
    this.code = code;
  }
}

function check(condition, code, message = code) {
  if (!condition) throw new FleetError(code, message);
}

function integer(value, min, max, label) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, 'invalid_input', `${label} must be an integer from ${min} to ${max}`);
  return value;
}

function string(value, label, max = 200) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), 'invalid_input', `Invalid ${label}`);
  return value;
}

function encode(value, label = 'payload') {
  let encoded;
  try {
    encoded = JSON.stringify(value, (_key, item) => {
      if (['bigint', 'function', 'symbol', 'undefined'].includes(typeof item)) throw new Error('Unsupported JSON value');
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite JSON number');
      return item;
    });
  } catch {
    throw new FleetError('invalid_input', `${label} must be JSON-serializable`);
  }
  check(typeof encoded === 'string' && Buffer.byteLength(encoded) <= MAX_BYTES, 'input_too_large', `${label} exceeds 32 KiB`);
  return encoded;
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error : error?.message ?? 'Worker error';
  return { code: String(error?.code ?? 'worker_error').slice(0, 100), message: String(message).slice(0, 4096) };
}

function privateDatabasePath(dbPath) {
  string(dbPath, 'database path', 4096);
  if (dbPath === ':memory:') return dbPath;
  const absolute = resolve(dbPath);
  const directory = dirname(absolute);
  check(directory !== parse(directory).root && directory !== tmpdir(), 'unsafe_database_directory', 'Use a dedicated private directory for the database');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  check(!lstatSync(directory).isSymbolicLink(), 'unsafe_database_path', 'Database directory must not be a symlink');
  chmodSync(directory, 0o700);
  if (!existsSync(absolute)) {
    try { closeSync(openSync(absolute, 'wx', 0o600)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  check(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink(), 'unsafe_database_path');
  chmodSync(absolute, 0o600);
  return absolute;
}

export class FleetStore {
  constructor(dbPath, options = {}) {
    check(validObject(options), 'invalid_input', 'Options must be an object');
    const maxConcurrency = integer(options.maxConcurrency ?? 4, 1, 4, 'maxConcurrency');
    const maxCallsPerDay = integer(options.maxCallsPerDay ?? 2000, 0, 2000, 'maxCallsPerDay');
    this.dbPath = privateDatabasePath(dbPath);
    this.closed = false;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS fleet_settings (id INTEGER PRIMARY KEY CHECK(id=1), max_concurrency INTEGER NOT NULL, max_calls_per_day INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, role TEXT NOT NULL, definition_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agents_role ON agents(role,id);
      CREATE TABLE IF NOT EXISTS jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL REFERENCES agents(id), instruction TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, request_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed','blocked')),
        max_steps INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, model_calls INTEGER NOT NULL DEFAULT 0,
        worker_id TEXT, lease_token TEXT, lease_expires_at INTEGER,
        result_json TEXT, error_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        CHECK(status!='done' OR result_json IS NOT NULL),
        CHECK(attempts BETWEEN 0 AND 3), CHECK(model_calls>=0)
      );
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,seq);
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_job_per_agent ON jobs(agent_id) WHERE status='running';
      CREATE TABLE IF NOT EXISTS model_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK(calls>=0));
      CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), type TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_job ON job_events(job_id,id);
    `);
    try {
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO fleet_settings(id,max_concurrency,max_calls_per_day) VALUES(1,?,?)').run(maxConcurrency, maxCallsPerDay);
        const row = this.db.prepare('SELECT * FROM fleet_settings WHERE id=1').get();
        if ('maxConcurrency' in options) check(row.max_concurrency === maxConcurrency, 'persistent_limits_mismatch');
        if ('maxCallsPerDay' in options) check(row.max_calls_per_day === maxCallsPerDay, 'persistent_limits_mismatch');
        this.limits = Object.freeze({ maxConcurrency: row.max_concurrency, maxCallsPerDay: row.max_calls_per_day, maxAttempts: MAX_ATTEMPTS });
      });
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  transaction(operation) {
    check(!this.closed, 'store_closed');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  seed(agents) {
    check(Array.isArray(agents) && agents.length <= 10000, 'invalid_input', 'Expected at most 10000 agent definitions');
    const definitions = agents.map(agent => {
      check(validObject(agent), 'invalid_input', 'Agent must be an object');
      const tools = agent.allowedTools ?? [];
      check(Array.isArray(tools) && tools.length <= TOOLS.size && tools.every(tool => TOOLS.has(tool)) && new Set(tools).size === tools.length, 'invalid_input', 'Invalid allowedTools');
      const normalized = {
        id: string(agent.id, 'agent id'),
        name: string(agent.name ?? agent.id, 'agent name', 400),
        role: string(agent.role ?? 'general', 'role'),
        sector: string(agent.sector ?? 'general', 'sector'),
        market: string(agent.market ?? 'global', 'market'),
        instructions: string(agent.instructions, 'agent instructions', MAX_BYTES),
        allowedTools: [...tools],
      };
      return { agent: normalized, encoded: encode(normalized, 'agent definition') };
    });
    return this.transaction(() => {
      let inserted = 0;
      const get = this.db.prepare('SELECT definition_json FROM agents WHERE id=?');
      const insert = this.db.prepare('INSERT INTO agents(id,role,definition_json) VALUES(?,?,?)');
      for (const { agent, encoded } of definitions) {
        const existing = get.get(agent.id);
        if (existing) check(existing.definition_json === encoded, 'agent_definition_conflict', `Agent ${agent.id} has a different persisted definition`);
        else { insert.run(agent.id, agent.role, encoded); inserted++; }
      }
      return { inserted, existing: definitions.length - inserted, total: this.db.prepare('SELECT count(*) AS n FROM agents').get().n };
    });
  }

  listAgents({ limit = 100, offset = 0, role } = {}) {
    integer(limit, 1, 10000, 'limit'); integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
    const rows = role === undefined
      ? this.db.prepare('SELECT definition_json FROM agents ORDER BY id LIMIT ? OFFSET ?').all(limit, offset)
      : this.db.prepare('SELECT definition_json FROM agents WHERE role=? ORDER BY id LIMIT ? OFFSET ?').all(string(role, 'role'), limit, offset);
    return rows.map(row => JSON.parse(row.definition_json));
  }

  agent(id) {
    const row = this.db.prepare('SELECT definition_json FROM agents WHERE id=?').get(string(id, 'agent id'));
    return row ? JSON.parse(row.definition_json) : null;
  }

  createJob({ agentId, instruction, idempotencyKey, maxSteps = 4, maxOutputTokens = 256 }) {
    string(agentId, 'agent id'); string(instruction, 'instruction', MAX_BYTES);
    string(idempotencyKey, 'idempotency key');
    check(!/[\r\n]/.test(idempotencyKey), 'invalid_input', 'Invalid idempotency key');
    integer(maxSteps, 1, 8, 'maxSteps'); integer(maxOutputTokens, 32, 1024, 'maxOutputTokens');
    const body = encode({ agentId, instruction, maxSteps, maxOutputTokens }, 'job input');
    const fingerprint = createHash('sha256').update(body).digest('hex');
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(idempotencyKey);
      if (existing) {
        check(existing.request_fingerprint === fingerprint, 'idempotency_conflict');
        return this.toJob(existing);
      }
      check(Boolean(this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(agentId)), 'unknown_agent');
      const now = Date.now(), id = `job-${randomUUID()}`;
      this.db.prepare(`INSERT INTO jobs(id,agent_id,instruction,idempotency_key,request_fingerprint,status,max_steps,max_output_tokens,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?)`).run(id, agentId, instruction, idempotencyKey, fingerprint, maxSteps, maxOutputTokens, now, now);
      this.event(id, 'created', { agentId }, now);
      return this.getJob(id);
    });
  }

  claim(workerId, { leaseMs = 120000 } = {}) {
    string(workerId, 'worker id'); integer(leaseMs, 1, 900000, 'leaseMs');
    return this.transaction(() => {
      const now = Date.now();
      this.recover(now);
      const count = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE status='running'").get().n;
      if (count >= this.limits.maxConcurrency) return null;
      const next = this.db.prepare(`SELECT * FROM jobs candidate WHERE status='queued' AND attempts<3 AND NOT EXISTS (SELECT 1 FROM jobs current WHERE current.agent_id=candidate.agent_id AND current.status='running') ORDER BY seq LIMIT 1`).get();
      if (!next) return null;
      const token = randomUUID();
      this.db.prepare("UPDATE jobs SET status='running',attempts=attempts+1,worker_id=?,lease_token=?,lease_expires_at=?,updated_at=?,error_json=NULL WHERE id=?").run(workerId, token, now + leaseMs, now, next.id);
      this.event(next.id, 'claimed', { workerId, attempt: next.attempts + 1 }, now);
      return this.getJob(next.id);
    });
  }

  ownLease(jobId, leaseToken, now = Date.now()) {
    string(jobId, 'job id'); string(leaseToken, 'lease token');
    const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    check(job?.status === 'running' && job.lease_token === leaseToken && job.lease_expires_at > now, 'stale_lease');
    return job;
  }

  renew(jobId, leaseToken, leaseMs = 120000) {
    integer(leaseMs, 1, 900000, 'leaseMs');
    return this.transaction(() => {
      const now = Date.now(); this.ownLease(jobId, leaseToken, now);
      this.db.prepare('UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=?').run(now + leaseMs, now, jobId);
      return this.getJob(jobId);
    });
  }

  complete(jobId, leaseToken, result) {
    check(validObject(result), 'invalid_result', 'A completed job requires a JSON object result');
    const encoded = encode(result, 'job result');
    return this.transaction(() => {
      const now = Date.now(); this.ownLease(jobId, leaseToken, now);
      this.db.prepare("UPDATE jobs SET status='done',result_json=?,error_json=NULL,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").run(encoded, now, jobId);
      this.event(jobId, 'completed', { resultStored: true }, now);
      return this.getJob(jobId);
    });
  }

  fail(jobId, leaseToken, error, { retryable = false } = {}) {
    check(typeof retryable === 'boolean', 'invalid_input');
    return this.transaction(() => {
      const now = Date.now(), job = this.ownLease(jobId, leaseToken, now);
      const status = retryable && job.attempts < MAX_ATTEMPTS && job.model_calls < job.max_steps ? 'queued' : 'failed';
      const detail = normalizeError(error);
      this.finishState(jobId, status, detail, now);
      this.event(jobId, status === 'queued' ? 'retry_queued' : 'failed', detail, now);
      return this.getJob(jobId);
    });
  }

  block(jobId, leaseToken, error) {
    return this.transaction(() => {
      const now = Date.now(); this.ownLease(jobId, leaseToken, now);
      const detail = normalizeError(error);
      this.finishState(jobId, 'blocked', detail, now);
      this.event(jobId, 'blocked', detail, now);
      return this.getJob(jobId);
    });
  }

  finishState(jobId, status, error, now) {
    this.db.prepare('UPDATE jobs SET status=?,error_json=?,result_json=NULL,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?').run(status, encode(error, 'job error'), now, jobId);
  }

  retry(jobId) {
    return this.transaction(() => {
      const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(string(jobId, 'job id'));
      check(Boolean(job), 'unknown_job');
      check(['failed', 'blocked'].includes(job.status), 'invalid_job_state');
      check(job.attempts < MAX_ATTEMPTS, 'retry_limit');
      check(job.model_calls < job.max_steps, 'step_limit');
      this.db.prepare("UPDATE jobs SET status='queued',error_json=NULL,updated_at=? WHERE id=?").run(Date.now(), jobId);
      this.event(jobId, 'manual_retry', { attempts: job.attempts });
      return this.getJob(jobId);
    });
  }

  recover(now) {
    const expired = this.db.prepare("SELECT * FROM jobs WHERE status='running' AND lease_expires_at<=?").all(now);
    let requeued = 0, failed = 0;
    for (const job of expired) {
      const status = job.attempts < MAX_ATTEMPTS && job.model_calls < job.max_steps ? 'queued' : 'failed';
      this.finishState(job.id, status, { code: 'lease_expired', message: 'Worker lease expired; previous completion tokens are fenced out' }, now);
      this.event(job.id, 'lease_expired', { nextStatus: status, attempt: job.attempts }, now);
      if (status === 'queued') requeued++; else failed++;
    }
    return { recovered: expired.length, requeued, failed };
  }

  recoverExpired() { return this.transaction(() => this.recover(Date.now())); }

  reserveModelCall(jobId, leaseToken) {
    return this.transaction(() => {
      const now = Date.now(), job = this.ownLease(jobId, leaseToken, now);
      check(job.model_calls < job.max_steps, 'step_limit');
      const day = new Date(now).toISOString().slice(0, 10);
      const usage = this.db.prepare('SELECT calls FROM model_usage WHERE day=?').get(day)?.calls ?? 0;
      check(usage < this.limits.maxCallsPerDay, 'daily_model_call_limit');
      this.db.prepare('INSERT INTO model_usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
      this.db.prepare('UPDATE jobs SET model_calls=model_calls+1,updated_at=? WHERE id=?').run(now, jobId);
      this.event(jobId, 'model_call_reserved', { day, call: job.model_calls + 1 }, now);
      return { reserved: true, day, callsToday: usage + 1, remainingToday: this.limits.maxCallsPerDay - usage - 1, modelCalls: job.model_calls + 1 };
    });
  }

  event(jobId, type, data, now = Date.now()) {
    this.db.prepare('INSERT INTO job_events(job_id,type,data_json,created_at) VALUES(?,?,?,?)').run(jobId, string(type, 'event type', 100), encode(data, 'event data'), now);
  }

  addEvent(jobId, type, data) {
    return this.transaction(() => {
      check(Boolean(this.getJob(jobId)), 'unknown_job');
      this.event(jobId, type, data);
    });
  }

  toJob(row) {
    if (!row) return null;
    return {
      id: row.id, agentId: row.agent_id, instruction: row.instruction,
      idempotencyKey: row.idempotency_key, status: row.status,
      maxSteps: row.max_steps, maxOutputTokens: row.max_output_tokens,
      attempts: row.attempts, maxAttempts: MAX_ATTEMPTS, modelCalls: row.model_calls,
      workerId: row.worker_id, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at,
      result: row.result_json === null ? null : JSON.parse(row.result_json),
      error: row.error_json === null ? null : JSON.parse(row.error_json),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  getJob(id) { return this.toJob(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(string(id, 'job id'))); }

  listJobs({ limit = 100, offset = 0 } = {}) {
    integer(limit, 1, 10000, 'limit'); integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
    return this.db.prepare('SELECT * FROM jobs ORDER BY seq DESC LIMIT ? OFFSET ?').all(limit, offset).map(row => this.toJob(row));
  }

  stats() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, blocked: 0 };
    for (const row of this.db.prepare('SELECT status,count(*) AS n FROM jobs GROUP BY status').all()) counts[row.status] = row.n;
    const day = new Date().toISOString().slice(0, 10);
    const modelCallsToday = this.db.prepare('SELECT calls FROM model_usage WHERE day=?').get(day)?.calls ?? 0;
    return {
      agents: this.db.prepare('SELECT count(*) AS n FROM agents').get().n,
      jobs: Object.values(counts).reduce((sum, n) => sum + n, 0),
      ...counts, completed: counts.done, byStatus: counts,
      activeLeases: this.db.prepare("SELECT count(*) AS n FROM jobs WHERE status='running' AND lease_expires_at>?").get(Date.now()).n,
      modelCallsToday, callsToday: modelCallsToday, day, limits: this.limits,
      roles: Object.fromEntries(this.db.prepare('SELECT role,count(*) AS n FROM agents GROUP BY role ORDER BY role').all().map(row => [row.role, row.n])),
      revenue_usdc: null, sale_proven: false,
    };
  }

  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
