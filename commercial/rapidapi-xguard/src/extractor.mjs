import { lookup } from 'node:dns';
import net from 'node:net';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { Agent, fetch } from 'undici';

const DEFAULT_MAX_HTML_BYTES = 5_000_000;
const DEFAULT_MAX_CONTENT_CHARS = 200_000;
const MAX_REDIRECTS = 5;
const MAX_LINKS = 200;

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
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

function isBlockedIp(address) {
  const normalized = String(address).toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family !== 6) return true;

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (net.isIP(host) > 0 && isBlockedIp(host))
  );
}

export function assertPublicHttpUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not allowed');
  if (isBlockedHostname(parsed.hostname)) throw new Error('Private, loopback, link-local, multicast, and internal destinations are blocked');
  return parsed;
}

const safeDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      if (isBlockedHostname(hostname)) {
        callback(new Error('Blocked destination'));
        return;
      }
      lookup(hostname, { ...options, all: false }, (error, address, family) => {
        if (error) {
          callback(error);
          return;
        }
        if (isBlockedIp(address)) {
          callback(new Error('DNS resolved to a blocked address'));
          return;
        }
        callback(null, address, family);
      });
    },
  },
});

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
  try {
    const resolved = new URL(value, base);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    assertPublicHttpUrl(resolved.href);
    return resolved.href;
  } catch {
    return null;
  }
}

function positiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchPublicHtml(rawUrl, options = {}) {
  let current = assertPublicHttpUrl(rawUrl);
  const timeoutMs = positiveInteger(options.timeoutMs, 20_000, 1_000, 60_000);
  const maxHtmlBytes = positiveInteger(options.maxHtmlBytes, DEFAULT_MAX_HTML_BYTES, 100_000, 10_000_000);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    current = assertPublicHttpUrl(current.href);
    const response = await fetch(current, {
      dispatcher: safeDispatcher,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'XGuard-Web-Extractor/1.0 (+https://xguardgate.com)',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect ${response.status} did not include a Location header`);
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects');
      current = assertPublicHttpUrl(new URL(location, current).href);
      await response.body?.cancel();
      continue;
    }

    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
    }

    return {
      html: await readBodyWithLimit(response, maxHtmlBytes),
      url: current.href,
      statusCode: response.status,
      contentType,
    };
  }

  throw new Error('Redirect processing failed');
}

export function extractHtml(html, url, options = {}) {
  const maxContentChars = positiveInteger(options.maxContentChars, DEFAULT_MAX_CONTENT_CHARS, 1_000, 1_000_000);
  const includeLinks = options.includeLinks !== false;
  const $ = cheerio.load(html);

  const title = normalizeText($('title').first().text());
  const description = normalizeText(
    $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
  );
  const lang = normalizeText($('html').attr('lang') || '');
  const canonical = absoluteUrl($('link[rel="canonical"]').attr('href') || '', url);

  const root = ($('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body').first()).clone();
  root
    .find(
      'script,style,noscript,template,svg,canvas,iframe,nav,footer,form,button,input,select,textarea,[aria-hidden="true"],.advertisement,.advert,.ads,.cookie-banner,.cookie-consent',
    )
    .remove();

  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });
  turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas']);

  const markdown = normalizeText(turndown.turndown(root.html() || '')).slice(0, maxContentChars);
  const text = normalizeText(root.text()).slice(0, maxContentChars);
  const links = [];

  if (includeLinks) {
    const seen = new Set();
    $('a[href]').each((_, element) => {
      if (links.length >= MAX_LINKS) return;
      const href = absoluteUrl($(element).attr('href'), url);
      if (!href || seen.has(href)) return;
      seen.add(href);
      links.push({ url: href, text: normalizeText($(element).text()).slice(0, 300) });
    });
  }

  return {
    url,
    title,
    description,
    lang: lang || null,
    canonical,
    markdown,
    text,
    links,
    contentLength: markdown.length,
    extractedAt: new Date().toISOString(),
    product: 'XGuard Web Extractor',
    schemaVersion: 1,
  };
}

export async function extractUrl(url, options = {}) {
  const fetched = await fetchPublicHtml(url, options);
  return {
    ...extractHtml(fetched.html, fetched.url, options),
    statusCode: fetched.statusCode,
    contentType: fetched.contentType,
  };
}
