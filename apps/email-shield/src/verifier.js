const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DISPOSABLE = new Set([
  "10minutemail.com","10minutemail.net","20minutemail.com","discard.email","discardmail.com",
  "dispostable.com","emailondeck.com","fakeinbox.com","fakemail.net","getairmail.com","getnada.com",
  "guerrillamail.com","guerrillamail.net","guerrillamail.org","maildrop.cc","mailinator.com",
  "mailnesia.com","mintemail.com","mohmal.com","mytemp.email","sharklasers.com","spam4.me",
  "temp-mail.org","tempail.com","tempemail.com","tempmail.com","tempmail.net","tempmailo.com",
  "throwawaymail.com","trashmail.com","yopmail.com","yopmail.fr","yopmail.net"
]);
const ROLES = new Set(["abuse","admin","billing","compliance","contact","help","hello","info","legal","marketing","noreply","no-reply","office","postmaster","privacy","sales","security","support","team","webmaster"]);
const COMMON = ["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","proton.me"];

export async function verifyEmail(input, env) {
  const n = normalize(input);
  if (!n.ok) return out(input, n.email || "", "reject", 0, [n.reason], checks(false, false, false, false, null, "invalid"));
  const { email, local, domain } = n;
  const disposable = isDisposable(domain);
  const role = ROLES.has(local.toLowerCase());
  const typo = typoSuggestion(domain);
  const dns = await mailDns(domain);
  if (dns.error) return out(input, email, "review", 50, ["dns_unavailable"], checks(true, false, disposable, role, typo, "unknown"));
  if (disposable) return out(input, email, "reject", 5, ["disposable_domain"], checks(true, dns.mx, true, role, typo, "risky"));
  if (dns.nullMx) return out(input, email, "reject", 0, ["domain_explicitly_accepts_no_email"], checks(true, false, false, role, typo, "invalid"));
  if (!dns.mailRoute) return out(input, email, "reject", 0, ["no_mail_route"], checks(true, false, false, role, typo, "invalid"));
  if (typo) return out(input, email, "review", 45, ["possible_domain_typo"], checks(true, dns.mx, false, role, typo, "unknown"));

  let mailbox = null;
  if (env.MAILBOX_VERIFY_URL) mailbox = await mailboxUpstream(email, env).catch(() => null);
  if (mailbox === "invalid") return out(input, email, "reject", 0, ["mailbox_rejected"], checks(true, dns.mx, false, role, null, "invalid"));
  if (mailbox === "deliverable") return out(input, email, role ? "review" : "accept", role ? 80 : 98, role ? ["role_address"] : [], checks(true, dns.mx, false, role, null, "deliverable"));
  return out(input, email, role ? "review" : "accept", role ? 70 : 90, role ? ["role_address"] : [], checks(true, dns.mx, false, role, null, "unknown"));
}

function checks(syntax, mx, disposable, role, typo, deliverability) { return { syntax, mx, disposable, role, typo, deliverability }; }
function out(input, email, decision, score, reasons, detail) { return { input, email, decision, score, reasons, checks: detail }; }

function normalize(value) {
  const email = String(value).trim();
  if (email.length < 3 || email.length > 254) return { ok: false, email, reason: "invalid_length" };
  if (/[\u0000-\u001F\u007F\s]/.test(email)) return { ok: false, email, reason: "invalid_whitespace_or_control" };
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@") || at === email.length - 1) return { ok: false, email, reason: "invalid_syntax" };
  const local = email.slice(0, at);
  let domain = email.slice(at + 1).toLowerCase();
  if (local.length > 64 || domain.length > 253) return { ok: false, email, reason: "invalid_length" };
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return { ok: false, email, reason: "unsupported_or_invalid_local_part" };
  try { domain = new URL(`http://${domain}`).hostname; } catch { return { ok: false, email, reason: "invalid_domain" }; }
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((x) => !x || x.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(x))) return { ok: false, email, reason: "invalid_domain" };
  if (labels.at(-1).length < 2) return { ok: false, email, reason: "invalid_tld" };
  return { ok: true, email: `${local}@${domain}`, local, domain };
}

function isDisposable(domain) {
  return DISPOSABLE.has(domain) || /(^|[.-])(temp|trash|throwaway|disposable|guerrilla|mailinator|yopmail|10minute|fakeinbox)([.-]|$)/i.test(domain);
}
function typoSuggestion(domain) {
  for (const target of COMMON) if (domain !== target && distanceOne(domain, target)) return target;
  return null;
}
function distanceOne(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits === 1;
}

async function mailDns(domain) {
  try {
    const mx = await doh(domain, "MX");
    const rows = Array.isArray(mx.Answer) ? mx.Answer : [];
    const records = rows.filter((x) => x.type === 15).map((x) => String(x.data || ""));
    if (records.some((x) => /\s\.$/.test(x.trim()))) return { mx: false, nullMx: true, mailRoute: false, error: false };
    if (records.length) return { mx: true, nullMx: false, mailRoute: true, error: false };
    const [a, aaaa] = await Promise.all([doh(domain, "A"), doh(domain, "AAAA")]);
    const mailRoute = [a, aaaa].some((r) => Array.isArray(r.Answer) && r.Answer.some((x) => x.type === 1 || x.type === 28));
    return { mx: false, nullMx: false, mailRoute, error: false };
  } catch { return { mx: false, nullMx: false, mailRoute: null, error: true }; }
}
async function doh(name, type) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const r = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: "application/dns-json" }, signal: controller.signal });
    if (!r.ok) throw new Error(`doh_http_${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function mailboxUpstream(email, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = { "Content-Type": "application/json" };
    if (env.MAILBOX_VERIFY_TOKEN) headers.Authorization = `Bearer ${env.MAILBOX_VERIFY_TOKEN}`;
    const r = await fetch(env.MAILBOX_VERIFY_URL, { method: "POST", headers, body: JSON.stringify({ email }), signal: controller.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const state = String(data.deliverability || data.status || "").toLowerCase();
    if (["deliverable","valid","ok"].includes(state)) return "deliverable";
    if (["invalid","undeliverable","reject"].includes(state)) return "invalid";
    return null;
  } finally { clearTimeout(timer); }
}
