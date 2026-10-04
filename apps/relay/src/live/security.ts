import { isPrivateIpv4, isPrivateIpv6, publicDns } from '../core/network-policy.js';
import { controlName, hash, rpc } from './util.ts';
import type { Env } from './types.ts';

export const SOURCE_HOSTS = new Set(['registry.npmjs.org', 'pypi.org', 'api.github.com', 'nodejs.org', 'www.python.org',
  'www.githubstatus.com', 'www.cloudflarestatus.com', 'status.claude.com', 'status.anthropic.com', 'status.openai.com', 'status.npmjs.org',
  'developers.openai.com', 'platform.claude.com']);
export function allowedUrl(raw: string, origin?: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !SOURCE_HOSTS.has(url.hostname)
    || isPrivateIpv4(url.hostname) || isPrivateIpv6(url.hostname) || (origin && url.origin !== origin)) throw new Error('source_url_not_allowed');
  return url;
}
export function robotsAllows(body: string, path: string, agent = 'xguardlivebot'): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let group: { agents: string[]; rules: { allow: boolean; pattern: string }[] } | null = null, rulesStarted = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(), split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase(), value = line.slice(split + 1).trim();
    if (key === 'user-agent') {
      if (!group || rulesStarted) { group = { agents: [], rules: [] }; groups.push(group); rulesStarted = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) {
      rulesStarted = true; if (value) group.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const specificity = (g: typeof groups[number]) => Math.max(-1, ...g.agents.map(a => a === '*' ? 0 : agent.toLowerCase().includes(a) ? a.length : -1));
  const best = Math.max(-1, ...groups.map(specificity));
  const rules = groups.filter(g => specificity(g) === best).flatMap(g => g.rules).filter(rule => {
    const end = rule.pattern.endsWith('$'), pattern = end ? rule.pattern.slice(0, -1) : rule.pattern;
    const regex = '^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (end ? '$' : '');
    return new RegExp(regex).test(path);
  }).sort((a, b) => b.pattern.replace(/[*$]/g, '').length - a.pattern.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}
export async function boundedBody(response: Response, maxBytes = 4 * 1024 * 1024): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('source_too_large');
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
      if (bytes > maxBytes) throw new Error('source_too_large'); text += decoder.decode(next.value, { stream: true }); }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
export async function safeFetch(raw: string, headers: Record<string, string> = {}, fetcher: typeof fetch = fetch, dnsCheck = true): Promise<Response> {
  const initial = allowedUrl(raw); let current = initial;
  for (let count = 0; count < 4; count++) {
    if (dnsCheck) { const dns = await publicDns(current.hostname, 8000); if (!dns.ok) throw new Error(dns.code); }
    const response = await fetcher(current.href, { redirect: 'manual', headers: { 'user-agent': 'XGuardLiveBot/1.0 (+https://xguardgate.com/methodology)', accept: 'application/json,text/html;q=0.8', ...headers }, signal: AbortSignal.timeout(12000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location) throw new Error('redirect_without_location');
    current = allowedUrl(new URL(location, current).href, initial.origin);
  }
  throw new Error('too_many_redirects');
}
export async function checkRobots(url: string, env: Env): Promise<void> {
  const target = allowedUrl(url);
  let cached = await rpc(env.LIVE_CONTROL, controlName, 'robots-get', { domain: target.hostname });
  if (!cached || Date.now() - cached.checked_at > 86400000) {
    const response = await safeFetch(`${target.origin}/robots.txt`, { accept: 'text/plain' });
    if (response.status !== 404 && !response.ok) throw new Error('robots_unavailable');
    const body = response.status === 404 ? '' : await boundedBody(response, 512000);
    cached = { domain: target.hostname, body, checked_at: Date.now(), status: response.status };
    await rpc(env.LIVE_CONTROL, controlName, 'robots-set', cached);
  }
  if (!robotsAllows(cached.body, target.pathname + target.search)) throw new Error('robots_disallowed');
}
export async function equalSecret(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const aa = await hash(a), bb = await hash(b); let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}
async function hmac(key: string, message: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', material, new TextEncoder().encode(message))), x => x.toString(16).padStart(2, '0')).join('');
}
export async function sessionToken(env: Env): Promise<string> {
  const key = env.LIVE_SESSION_KEY || env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
  if (!key || key.length < 24) throw new Error('admin_unconfigured');
  const payload = `${Date.now() + 8 * 3600000}.${crypto.randomUUID()}`;
  return `${payload}.${await hmac(key, payload)}`;
}
export async function adminIdentity(request: Request, env: Env): Promise<'bearer' | 'session' | null> {
  const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
  if (!key || key.length < 24) return null;
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (bearer && await equalSecret(bearer, key)) return 'bearer';
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-xguard-live=([^;]+)/)?.[1];
  if (!token) return null;
  const [expires, nonce, signature, extra] = token.split('.');
  if (extra || !/^\d+$/.test(expires) || !nonce || !signature || Number(expires) < Date.now() || Number(expires) > Date.now() + 8 * 3600000) return null;
  return await equalSecret(signature, await hmac(env.LIVE_SESSION_KEY || key, `${expires}.${nonce}`)) ? 'session' : null;
}
export function securityHeaders(): Record<string, string> {
  return { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000; includeSubDomains', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; script-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'content-signal': 'search=yes, ai-input=yes, ai-train=no' };
}
