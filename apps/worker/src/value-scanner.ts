import { valueHarvesterResponse } from "./value-harvester.js";

interface ValueScannerEnv {
  DB: D1Database;
  XGUARD_VALUE_API_KEY?: string;
  XGUARD_VALUE_FEEDS?: string;
  XGUARD_VALUE_FEED_HOSTS?: string;
}

interface FeedConfig {
  id: string;
  url: string;
}

interface ScannerStats {
  feeds: number;
  recorded: number;
  skipped: number;
  failed: number;
}

const MAX_FEEDS = 8;
const MAX_ITEMS_PER_FEED = 100;
const MAX_FEED_BYTES = 1_048_576;
const FETCH_TIMEOUT_MS = 8_000;

export async function runValueScanner(env: ValueScannerEnv): Promise<void> {
  const apiKey = env.XGUARD_VALUE_API_KEY?.trim();
  const rawFeeds = env.XGUARD_VALUE_FEEDS?.trim();
  const allowedHosts = readAllowedHosts(env.XGUARD_VALUE_FEED_HOSTS);

  if (!apiKey || !rawFeeds || allowedHosts.size === 0) return;

  const feeds = parseFeeds(rawFeeds, allowedHosts);
  if (feeds.length === 0) return;

  await ensureScannerSchema(env.DB);

  const settled = await Promise.allSettled(
    feeds.map((feed) => scanFeed(feed, env, apiKey)),
  );

  const stats: ScannerStats = {
    feeds: feeds.length,
    recorded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const result of settled) {
    if (result.status === "rejected") {
      stats.failed += 1;
      continue;
    }
    stats.recorded += result.value.recorded;
    stats.skipped += result.value.skipped;
    stats.failed += result.value.failed;
  }

  console.log(
    JSON.stringify({
      event: "value_scanner_complete",
      ...stats,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function scanFeed(
  feed: FeedConfig,
  env: ValueScannerEnv,
  apiKey: string,
): Promise<Omit<ScannerStats, "feeds">> {
  const stats = { recorded: 0, skipped: 0, failed: 0 };

  let items: Record<string, unknown>[];
  try {
    items = await fetchFeed(feed.url);
  } catch {
    stats.failed += 1;
    return stats;
  }

  for (const item of items.slice(0, MAX_ITEMS_PER_FEED)) {
    const externalId = readExternalId(item.externalId);
    if (!externalId) {
      stats.skipped += 1;
      continue;
    }

    const reserved = await reserveDiscovery(env.DB, feed.id, externalId);
    if (!reserved) {
      stats.skipped += 1;
      continue;
    }

    try {
      const body = normalizeFeedOpportunity(feed.id, externalId, item);
      const request = new Request(
        "https://xguard.internal/v1/value/opportunities",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const response = await valueHarvesterResponse(request, env);
      if (!response || response.status !== 201) {
        await releaseDiscovery(env.DB, feed.id, externalId);
        stats.failed += 1;
        continue;
      }

      const result = (await response.json()) as { id?: unknown };
      const opportunityId =
        typeof result.id === "string" && result.id.length > 0
          ? result.id
          : null;
      if (!opportunityId) {
        await releaseDiscovery(env.DB, feed.id, externalId);
        stats.failed += 1;
        continue;
      }

      await commitDiscovery(env.DB, feed.id, externalId, opportunityId);
      stats.recorded += 1;
    } catch {
      await releaseDiscovery(env.DB, feed.id, externalId);
      stats.failed += 1;
    }
  }

  return stats;
}

async function fetchFeed(url: string): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "User-Agent": "XGuard-Value-Scanner/1",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("feed_http_error");

    const advertisedLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (advertisedLength > MAX_FEED_BYTES) throw new Error("feed_too_large");

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_FEED_BYTES) throw new Error("feed_too_large");

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.opportunities)
        ? parsed.opportunities
        : null;

    if (!rawItems) throw new Error("feed_shape_invalid");
    return rawItems.filter(isRecord);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFeedOpportunity(
  feedId: string,
  externalId: string,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const source =
    typeof item.source === "string" && item.source.trim()
      ? `${feedId}:${item.source.trim()}`
      : feedId;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const rest = { ...item };
  delete rest.externalId;
  delete rest.source;
  delete rest.metadata;

  return {
    ...rest,
    source,
    metadata: {
      ...metadata,
      scanner: {
        feedId,
        externalId,
        discoveredAt: new Date().toISOString(),
      },
    },
  };
}

function parseFeeds(raw: string, allowedHosts: Set<string>): FeedConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const feeds: FeedConfig[] = [];
  const seenIds = new Set<string>();

  for (const candidate of parsed.slice(0, MAX_FEEDS)) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const rawUrl =
      typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seenIds.has(id)) continue;

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      !allowedHosts.has(hostname)
    ) {
      continue;
    }

    seenIds.add(id);
    feeds.push({ id, url: url.toString() });
  }

  return feeds;
}

function readAllowedHosts(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => /^[a-z0-9.-]+$/.test(host) && !host.endsWith(".local")),
  );
}

function readExternalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const externalId = value.trim();
  if (!externalId || externalId.length > 200) return null;
  return externalId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureScannerSchema(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS value_scanner_seen (
      feed_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      opportunity_id TEXT,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (feed_id, external_id)
    );
  `);
}

async function reserveDiscovery(
  db: D1Database,
  feedId: string,
  externalId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO value_scanner_seen
       (feed_id, external_id, opportunity_id, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'RESERVED', ?, ?)`,
    )
    .bind(feedId, externalId, now, now)
    .run();

  return Number(result.meta.changes ?? 0) > 0;
}

async function commitDiscovery(
  db: D1Database,
  feedId: string,
  externalId: string,
  opportunityId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE value_scanner_seen
       SET opportunity_id = ?, state = 'RECORDED', updated_at = ?
       WHERE feed_id = ? AND external_id = ?`,
    )
    .bind(opportunityId, new Date().toISOString(), feedId, externalId)
    .run();
}

async function releaseDiscovery(
  db: D1Database,
  feedId: string,
  externalId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM value_scanner_seen
       WHERE feed_id = ? AND external_id = ? AND state = 'RESERVED'`,
    )
    .bind(feedId, externalId)
    .run();
}
