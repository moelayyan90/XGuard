interface CommerceSiteEnv {
  DB: D1Database;
  XGUARD_COMMERCE_MIN_PROFIT_USD?: string;
  XGUARD_COMMERCE_MIN_MARGIN_BPS?: string;
}

interface CommerceSnapshot {
  open_demands?: number | string | null;
  offers?: number | string | null;
  ready?: number | string | null;
  ready_profit_usd?: number | string | null;
  sent_outreach?: number | string | null;
  active_feeds?: number | string | null;
}

export async function commerceSiteResponse(
  request: Request,
  env: CommerceSiteEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    (url.pathname !== "/" && url.pathname !== "/commerce")
  ) {
    return null;
  }

  const snapshot = await loadSnapshot(env);
  const minProfit = positiveNumber(env.XGUARD_COMMERCE_MIN_PROFIT_USD, 100);
  const minMarginBps = positiveNumber(env.XGUARD_COMMERCE_MIN_MARGIN_BPS, 2000);
  const minMarginPct = minMarginBps / 100;

  return new Response(renderPage(snapshot, minProfit, minMarginPct), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30, stale-while-revalidate=120",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

async function loadSnapshot(env: CommerceSiteEnv): Promise<CommerceSnapshot> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM commerce_demands WHERE status='OPEN') AS open_demands,
         (SELECT COUNT(*) FROM commerce_offers) AS offers,
         (SELECT COUNT(*) FROM commerce_opportunities WHERE status='READY') AS ready,
         (SELECT COALESCE(SUM(net_profit_usd),0) FROM commerce_opportunities WHERE status='READY') AS ready_profit_usd,
         (SELECT COUNT(*) FROM commerce_outreach WHERE state='SENT') AS sent_outreach,
         (SELECT COUNT(*) FROM commerce_feeds WHERE enabled=1) AS active_feeds`,
    ).first<CommerceSnapshot>();
    return row ?? {};
  } catch {
    return {};
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function whole(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.floor(parsed)).toLocaleString("en-US")
    : "0";
}

function money(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(parsed);
}

function renderPage(
  snapshot: CommerceSnapshot,
  minProfit: number,
  minMarginPct: number,
): string {
  const stats = [
    [whole(snapshot.open_demands), "Open buyer demands"],
    [whole(snapshot.offers), "Supplier offers tracked"],
    [whole(snapshot.ready), "Qualified matches"],
    [money(snapshot.ready_profit_usd), "Qualified profit pool"],
  ];

  const statHtml = stats
    .map(
      ([value, label]) => `
        <div class="stat">
          <strong>${value}</strong>
          <span>${label}</span>
        </div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f4f2ed">
  <meta name="description" content="XGuard is a global B2B commerce engine that identifies documented demand, matches qualified supply, validates transaction economics, and proceeds only after funding or approved escrow is secured.">
  <title>XGuard — Global Commerce Engine</title>
  <style>
    :root {
      --page: #f4f2ed;
      --surface: #ffffff;
      --surface-soft: #efede7;
      --text: #24282b;
      --muted: #687078;
      --border: #d9d6cf;
      --accent: #385365;
      --accent-dark: #2c4351;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    .wrap { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }

    .site-header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .header-inner {
      min-height: 76px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
    }
    .brand {
      display: flex;
      align-items: baseline;
      gap: 12px;
      text-decoration: none;
      white-space: nowrap;
    }
    .brand-name { font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
    .brand-desc { color: var(--muted); font-size: 13px; font-weight: 400; }
    .nav-links { display: flex; align-items: center; gap: 26px; font-size: 14px; }
    .nav-links a { text-decoration: none; color: #4d555b; }
    .nav-links a:hover { color: var(--text); text-decoration: underline; text-underline-offset: 4px; }
    .status-link {
      border: 1px solid var(--border);
      padding: 8px 12px;
      background: #faf9f6;
    }

    .hero { padding: 76px 0 66px; }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr);
      gap: 72px;
      align-items: center;
    }
    .kicker { margin: 0 0 16px; color: var(--accent); font-size: 14px; font-weight: 600; }
    h1 {
      margin: 0;
      max-width: 760px;
      font-size: clamp(40px, 5vw, 58px);
      line-height: 1.08;
      letter-spacing: -.035em;
      font-weight: 600;
    }
    .lead {
      max-width: 740px;
      margin: 24px 0 0;
      color: #555e64;
      font-size: 19px;
      line-height: 1.7;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
    .button {
      display: inline-block;
      padding: 11px 17px;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }
    .button:hover { background: var(--accent-dark); }
    .text-link {
      display: inline-block;
      padding: 11px 4px;
      color: var(--accent-dark);
      font-size: 14px;
      font-weight: 600;
      text-underline-offset: 4px;
    }
    .hero-note {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 26px;
    }
    .hero-note h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
    .hero-note p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
    .hero-note dl { margin: 22px 0 0; }
    .hero-note .row {
      padding: 11px 0;
      border-top: 1px solid #e6e3dd;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      font-size: 13px;
    }
    .hero-note dt { color: var(--muted); }
    .hero-note dd { margin: 0; font-weight: 600; text-align: right; }

    .metrics-section { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .metrics-head { padding: 28px 0 0; }
    .metrics-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
    .metrics-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); padding: 22px 0 30px; }
    .stat { padding: 12px 22px; border-left: 1px solid var(--border); }
    .stat:first-child { border-left: 0; padding-left: 0; }
    .stat strong { display: block; font-size: 30px; line-height: 1.2; font-weight: 600; letter-spacing: -.025em; }
    .stat span { display: block; margin-top: 7px; color: var(--muted); font-size: 13px; }

    .section { padding: 72px 0; }
    .section + .section { border-top: 1px solid var(--border); }
    .section-heading { max-width: 720px; margin-bottom: 34px; }
    .section-heading h2 { margin: 0; font-size: 32px; line-height: 1.25; font-weight: 600; letter-spacing: -.02em; }
    .section-heading p { margin: 13px 0 0; color: var(--muted); font-size: 16px; }

    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      background: var(--surface);
      border: 1px solid var(--border);
    }
    .step { padding: 26px; min-height: 210px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .step:nth-child(3n) { border-right: 0; }
    .step:nth-child(n+4) { border-bottom: 0; }
    .step-number { display: block; color: var(--muted); font-size: 13px; margin-bottom: 28px; }
    .step h3 { margin: 0 0 9px; font-size: 18px; line-height: 1.35; font-weight: 600; }
    .step p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.65; }

    .controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .control {
      padding: 24px 26px;
      background: var(--surface);
      border: 1px solid var(--border);
    }
    .control h3 { margin: 0 0 7px; font-size: 17px; font-weight: 600; }
    .control p { margin: 0; color: var(--muted); font-size: 14px; }
    .operational-note {
      margin-top: 22px;
      padding: 20px 22px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      color: #555d62;
      font-size: 14px;
    }

    .principles {
      padding: 0 0 58px;
      display: flex;
      flex-wrap: wrap;
      gap: 0;
      color: var(--muted);
      font-size: 13px;
    }
    .principles span { padding-right: 18px; margin-right: 18px; border-right: 1px solid #c9c5bc; }
    .principles span:last-child { border-right: 0; }

    footer { background: #2f3437; color: #d9dde0; }
    .footer-inner {
      min-height: 118px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 30px;
      font-size: 13px;
    }
    .footer-inner strong { color: #fff; font-size: 15px; font-weight: 600; }
    .footer-copy { color: #aeb5ba; text-align: right; }

    @media (max-width: 900px) {
      .hero-grid { grid-template-columns: 1fr; gap: 34px; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .stat:nth-child(3) { border-left: 0; padding-left: 0; }
      .stat:nth-child(n+3) { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
      .steps { grid-template-columns: 1fr 1fr; }
      .step { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
      .step:nth-child(3n) { border-right: 1px solid var(--border); }
      .step:nth-child(2n) { border-right: 0; }
      .step:nth-child(n+4) { border-bottom: 1px solid var(--border); }
      .step:nth-last-child(-n+2) { border-bottom: 0; }
    }
    @media (max-width: 700px) {
      .header-inner { align-items: flex-start; padding: 18px 0; }
      .brand-desc { display: none; }
      .nav-links a:not(.status-link) { display: none; }
      .hero { padding: 54px 0 46px; }
      h1 { font-size: clamp(36px, 11vw, 48px); }
      .lead { font-size: 17px; }
      .controls-grid { grid-template-columns: 1fr; }
      .principles { display: block; }
      .principles span { display: block; border-right: 0; margin: 0; padding: 5px 0; }
      .footer-inner { align-items: flex-start; flex-direction: column; padding: 28px 0; }
      .footer-copy { text-align: left; }
    }
    @media (max-width: 540px) {
      .wrap { width: min(100% - 28px, 1120px); }
      .stats { grid-template-columns: 1fr; }
      .stat, .stat:first-child, .stat:nth-child(3) { padding: 18px 0; border-left: 0; border-top: 1px solid var(--border); margin: 0; }
      .stat:first-child { border-top: 0; }
      .steps { grid-template-columns: 1fr; }
      .step, .step:nth-child(2n), .step:nth-child(3n), .step:nth-child(n+4), .step:nth-last-child(-n+2) { border-right: 0; border-bottom: 1px solid var(--border); }
      .step:last-child { border-bottom: 0; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/" aria-label="XGuard home">
        <span class="brand-name">XGuard</span>
        <span class="brand-desc">Global Commerce Engine</span>
      </a>
      <nav class="nav-links" aria-label="Primary navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#controls">Transaction controls</a>
        <a class="status-link" href="/v1/commerce/status">Live status</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <p class="kicker">B2B transaction intelligence</p>
          <h1>Verified demand. Qualified supply. Better transactions.</h1>
          <p class="lead">XGuard identifies documented purchase demand, compares qualified supply, calculates the full landed economics, and proceeds only when the transaction meets its funding, margin and compliance requirements.</p>
          <div class="actions">
            <a class="button" href="/v1/commerce/status">View live engine status</a>
            <a class="text-link" href="#how-it-works">See how XGuard works</a>
          </div>
        </div>

        <aside class="hero-note">
          <h2>Operating model</h2>
          <p>XGuard is a B2B transaction engine rather than a consumer store. It works between documented buyer demand and documented supplier availability.</p>
          <dl>
            <div class="row"><dt>Inventory policy</dt><dd>No speculative stock</dd></div>
            <div class="row"><dt>Minimum profit gate</dt><dd>$${minProfit.toLocaleString("en-US")}</dd></div>
            <div class="row"><dt>Minimum gross margin</dt><dd>${minMarginPct.toLocaleString("en-US")}%</dd></div>
            <div class="row"><dt>Execution</dt><dd>Funding or approved escrow first</dd></div>
          </dl>
        </aside>
      </div>
    </section>

    <section class="metrics-section" aria-label="Live engine metrics">
      <div class="wrap">
        <div class="metrics-head">
          <h2>Current engine activity</h2>
          <p>Live operational figures from the commerce engine.</p>
        </div>
        <div class="stats">${statHtml}</div>
      </div>
    </section>

    <section class="section" id="how-it-works">
      <div class="wrap">
        <div class="section-heading">
          <h2>How XGuard works</h2>
          <p>The process begins with evidence of purchase demand and ends only when the transaction has passed commercial, operational and compliance checks.</p>
        </div>

        <div class="steps">
          <article class="step"><span class="step-number">01</span><h3>Document buyer demand</h3><p>Monitor public RFQs, tenders, procurement notices and structured commercial demand with traceable evidence.</p></article>
          <article class="step"><span class="step-number">02</span><h3>Identify qualified supply</h3><p>Match the required product or specification across suppliers and jurisdictions without purchasing stock in advance.</p></article>
          <article class="step"><span class="step-number">03</span><h3>Calculate landed economics</h3><p>Include unit cost, shipping, duties, tax, payment fees, insurance, reserves and lead time before qualifying a margin.</p></article>
          <article class="step"><span class="step-number">04</span><h3>Verify the transaction</h3><p>Reject restricted goods, identity mismatches, inadequate margins, weak evidence, expired demand and unverified availability.</p></article>
          <article class="step"><span class="step-number">05</span><h3>Secure buyer funding</h3><p>A supplier purchase is triggered only after buyer funding or approved escrow is secured under the applicable terms.</p></article>
          <article class="step"><span class="step-number">06</span><h3>Execute and fulfil</h3><p>Supplier cost is paid, delivery is completed, and the remaining verified spread becomes the gross transaction margin.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="controls">
      <div class="wrap">
        <div class="section-heading">
          <h2>Transaction controls</h2>
          <p>Potential deals are rejected unless the buyer, supplier, economics and legal constraints survive verification.</p>
        </div>

        <div class="controls-grid">
          <article class="control"><h3>Evidence-backed demand</h3><p>No invented buyers and no assumed willingness to pay. Commercial demand must have traceable support.</p></article>
          <article class="control"><h3>Verified economics</h3><p>Revenue is not treated as profit. Landed costs, transaction fees and required reserves are included first.</p></article>
          <article class="control"><h3>No inventory speculation</h3><p>XGuard does not purchase products in anticipation of a customer appearing later.</p></article>
          <article class="control"><h3>Compliance before execution</h3><p>Restricted goods and unclear jurisdictions are rejected rather than routed around.</p></article>
        </div>

        <div class="operational-note">Live operations are intentionally private. Public visitors can see what the engine does and whether it is active; buyer emails, supplier contacts and executable deal data remain behind the administrative boundary.</div>
      </div>
    </section>

    <div class="wrap principles" aria-label="Operating principles">
      <span>No speculative inventory</span>
      <span>Buyer funding or escrow before purchase</span>
      <span>Restricted goods excluded</span>
      <span>Qualified economics required</span>
    </div>
  </main>

  <footer>
    <div class="wrap footer-inner">
      <strong>XGuard</strong>
      <div class="footer-copy">Global Commerce Engine<br>Documented demand · Qualified supply · Funded execution</div>
    </div>
  </footer>
</body>
</html>`;
}