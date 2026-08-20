const MAIL_DOMAIN = "xguardgate.com";
const MAILBOXES = ["info", "support"] as const;
const MAX_SUBJECT = 300;
const MAX_BODY = 40_000;
const MAX_INBOUND_PREVIEW = 60_000;

type Mailbox = (typeof MAILBOXES)[number];

export interface SendEmailBinding {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string | string[];
  }): Promise<unknown>;
}

export interface XGuardMailEnv {
  DB: D1Database;
  EMAIL?: SendEmailBinding;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
}

interface SendInput {
  mailbox?: string;
  to?: string;
  subject?: string;
  text?: string;
}

export async function xguardMailHttpResponse(
  request: Request,
  env: XGuardMailEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/mail/status") {
    return json({
      domain: MAIL_DOMAIN,
      addresses: {
        info: `info@${MAIL_DOMAIN}`,
        support: `support@${MAIL_DOMAIN}`,
      },
      inboundStorage: "XGuard D1 mailbox archive",
      personalEmailForwarding: false,
      outboundProvider: env.EMAIL ? "Cloudflare Email Service" : "not_bound",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/mail/send") {
    if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401);
    if (!env.EMAIL) return json({ error: "email_sending_not_configured" }, 503);

    const input = await readJson<SendInput>(request);
    if (!input) return json({ error: "invalid_json" }, 400);

    const mailbox = normalizeMailbox(input.mailbox);
    const to = cleanEmail(input.to);
    const subject = clean(input.subject, MAX_SUBJECT);
    const text = clean(input.text, MAX_BODY);

    if (!mailbox) return json({ error: "invalid_mailbox" }, 400);
    if (!to) return json({ error: "invalid_recipient" }, 400);
    if (!subject) return json({ error: "subject_required" }, 400);
    if (!text) return json({ error: "text_required" }, 400);

    const fromAddress = `${mailbox}@${MAIL_DOMAIN}`;
    const providerResult = await env.EMAIL.send({
      to,
      from: {
        email: fromAddress,
        name: mailbox === "support" ? "XGuard Support" : "XGuard",
      },
      subject,
      text,
      replyTo: fromAddress,
    });

    const messageId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO xguard_mail_messages(message_id,mailbox,direction,from_address,to_address,subject,body_preview,provider_message_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        messageId,
        mailbox,
        "OUTBOUND",
        fromAddress,
        to,
        subject,
        text.slice(0, MAX_INBOUND_PREVIEW),
        providerMessageId(providerResult),
        "SENT",
        new Date().toISOString(),
      )
      .run();

    return json({
      sent: true,
      mailbox,
      from: fromAddress,
      to,
      messageId,
    });
  }

  return null;
}

export async function xguardInboundEmail(
  message: ForwardableEmailMessage,
  env: XGuardMailEnv,
): Promise<void> {
  const mailbox = mailboxFromAddress(message.to);
  if (!mailbox) {
    message.setReject("Unknown XGuard mailbox");
    return;
  }

  const raw = await new Response(message.raw).text();
  const subject = clean(message.headers.get("subject"), MAX_SUBJECT);
  const providerId = clean(message.headers.get("message-id"), 500);
  const fromAddress = clean(message.from, 500);
  const toAddress = `${mailbox}@${MAIL_DOMAIN}`;
  const messageId = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO xguard_mail_messages(message_id,mailbox,direction,from_address,to_address,subject,body_preview,provider_message_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      messageId,
      mailbox,
      "INBOUND",
      fromAddress,
      toAddress,
      subject,
      raw.slice(0, MAX_INBOUND_PREVIEW),
      providerId || null,
      "RECEIVED",
      new Date().toISOString(),
    )
    .run();
}

function mailboxFromAddress(value: string): Mailbox | null {
  const normalized = value.trim().toLowerCase();
  for (const mailbox of MAILBOXES) {
    if (normalized === `${mailbox}@${MAIL_DOMAIN}`) return mailbox;
  }
  return null;
}

function normalizeMailbox(value: unknown): Mailbox | null {
  const normalized = clean(value, 20).toLowerCase();
  return MAILBOXES.includes(normalized as Mailbox)
    ? (normalized as Mailbox)
    : null;
}

async function isAdmin(request: Request, env: XGuardMailEnv): Promise<boolean> {
  const expected = clean(env.XGUARD_ADMIN_TOKEN_SHA256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;
  return (await sha256(token)) === expected;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function providerMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return clean(record.messageId ?? record.message_id, 500) || null;
}

function cleanEmail(value: unknown): string {
  const email = clean(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
