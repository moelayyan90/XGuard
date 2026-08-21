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
        <article class="stat">
          <strong>${value}</strong>
          <span>${label}</span>
        </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07110d">
  <meta name="description" content="XGuard is an autonomous global B2B commerce engine that discovers verified demand, matches lower-cost supply, validates landed economics, and moves only after buyer funding or approved escrow is secured.">
  <title>XGuard — Global Commerce Engine</title>
  <style>
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: #07110d; color: #f2f7f4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { color: inherit; }
    .shell { width: min(1180px, calc(100% - 36px)); margin: 0 auto; }
    .nav { min-height: 78px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid rgba(255,255,255,.09); }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 900; letter-spacing: .06em; }
    .mark { width: 34px; height: 34px; border: 1px solid #56f39a; border-radius: 9px; display: grid; place-items: center; color: #56f39a; font-size: 18px; }
    .badge { padding: 8px 12px; border: 1px solid rgba(86,243,154,.34); color: #9bffc6; border-radius: 999px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; background: rgba(86,243,154,.05); }
    .hero { padding: 88px 0 56px; display: grid; grid-template-columns: 1.25fr .75fr; gap: 60px; align-items: end; }
    .eyebrow { color: #56f39a; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .16em; margin: 0 0 20px; }
    h1 { margin: 0; font-size: clamp(52px, 8vw, 104px); line-height: .9; letter-spacing: -.065em; max-width: 900px; }
    h1 em { color: #56f39a; font-style: normal; }
    .lead { margin: 28px 0 0; color: #aab9b1; font-size: clamp(18px, 2.1vw, 24px); line-height: 1.55; max-width: 760px; }
    .hero-side { border-left: 1px solid rgba(255,255,255,.12); padding-left: 26px; }
    .hero-side p { margin: 0 0 22px; color: #c4d0ca; line-height: 1.65; }
    .link { display: inline-flex; gap: 10px; align-items: center; color: #56f39a; text-decoration: none; font-weight: 800; }
    .strip { display: flex; gap: 10px; flex-wrap: wrap; padding: 0 0 44px; }
    .pill { border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 10px 14px; color: #c8d4ce; font-size: 13px; background: rgba(255,255,255,.025); }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.1); }
    .stat { padding: 28px 22px; min-height: 132px; border-right: 1px solid rgba(255,255,255,.1); }
    .stat:last-child { border-right: 0; }
    .stat strong { display: block; font-size: clamp(30px, 4vw, 48px); letter-spacing: -.045em; color: #f6fff9; }
    .stat span { display: block; margin-top: 8px; color: #819188; font-size: 13px; text-transform: uppercase; letter-spacing: .07em; }
    .section { padding: 82px 0; }
    .section-head { display: grid; grid-template-columns: .7fr 1.3fr; gap: 40px; margin-bottom: 36px; }
    .section h2 { margin: 0; font-size: clamp(38px, 5vw, 68px); line-height: .98; letter-spacing: -.05em; }
    .section-copy { color: #9baba2; font-size: 18px; line-height: 1.65; max-width: 720px; }
    .flow { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid rgba(255,255,255,.1); border-radius: 20px; overflow: hidden; }
    .step { padding: 28px; min-height: 220px; border-right: 1px solid rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.02); }
    .step:nth-child(3n) { border-right: 0; }
    .step:nth-child(n+4) { border-bottom: 0; }
    .num { color: #56f39a; font-size: 12px; font-weight: 900; letter-spacing: .15em; }
    .step h3 { font-size: 23px; margin: 46px 0 10px; letter-spacing: -.02em; }
    .step p { margin: 0; color: #8fa097; line-height: 1.55; }
    .rules { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .rule { border: 1px solid rgba(255,255,255,.09); border-radius: 16px; padding: 22px; display: flex; gap: 16px; align-items: flex-start; background: rgba(255,255,255,.018); }
    .tick { color: #56f39a; font-weight: 900; }
    .rule strong { display: block; margin-bottom: 5px; }
    .rule span { color: #8fa097; line-height: 1.45; }
    .note { margin-top: 28px; padding: 20px 22px; border-left: 3px solid #56f39a; background: rgba(86,243,154,.055); color: #bad0c4; line-height: 1.6; }
    footer { padding: 34px 0 50px; border-top: 1px solid rgba(255,255,255,.09); color: #708078; display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; font-size: 13px; }
    @media (max-width: 860px) {
      .hero, .section-head { grid-template-columns: 1fr; gap: 30px; }
      .hero-side { border-left: 0; border-top: 1px solid rgba(255,255,255,.12); padding: 24px 0 0; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .stat:nth-child(2) { border-right: 0; }
      .stat:nth-child(-n+2) { border-bottom: 1px solid rgba(255,255,255,.1); }
      .flow { grid-template-columns: 1fr; }
      .step { border-right: 0 !important; border-bottom: 1px solid rgba(255,255,255,.1) !important; }
      .step:last-child { border-bottom: 0 !important; }
      .rules { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      .shell { width: min(100% - 24px, 1180px); }
      .nav { min-height: 68px; }
      .badge { display: none; }
      .hero { padding-top: 60px; }
      .stats { grid-template-columns: 1fr; }
      .stat { border-right: 0; border-bottom: 1px solid rgba(255,255,255,.1); }
      .stat:last-child { border-bottom: 0; }
    }
  </style>
</head>
<body>
  <main>
    <div class="shell">
      <nav class="nav" aria-label="Primary">
        <div class="brand"><span class="mark">X</span><span>XGUARD</span></div>
        <div class="badge">Global commerce engine · live</div>
      </nav>

      <section class="hero">
        <div>
          <p class="eyebrow">Autonomous B2B deal intelligence</p>
          <h1>Demand first.<br><em>Supply second.</em><br>Margin captured.</h1>
          <p class="lead">XGuard finds real purchase demand, matches lower-cost supply, validates the full landed economics, and moves only when buyer funding or approved escrow is in place.</p>
        </div>
        <aside class="hero-side">
          <p>This is not a consumer storefront. XGuard operates between documented demand and documented supply, turning price and information gaps into defensible B2B transactions.</p>
          <a class="link" href="/v1/commerce/status">View live engine status →</a>
        </aside>
      </section>

      <div class="strip" aria-label="Operating constraints">
        <span class="pill">No speculative inventory</span>
        <span class="pill">Buyer funds / escrow before purchase</span>
        <span class="pill">Minimum qualified profit: $${minProfit.toLocaleString("en-US")}</span>
        <span class="pill">Minimum gross margin: ${minMarginPct.toLocaleString("en-US")}%</span>
        <span class="pill">Restricted goods excluded</span>
      </div>

      <section class="stats" aria-label="Live engine metrics">
        ${statHtml}
      </section>

      <section class="section">
        <div class="section-head">
          <p class="eyebrow">How money moves</p>
          <div>
            <h2>A transaction engine, not an online shop.</h2>
            <p class="section-copy">The system starts with evidence that someone already wants to buy. It then searches for a compliant source whose all-in cost leaves enough room to create real value and real margin.</p>
          </div>
        </div>

        <div class="flow">
          <article class="step"><span class="num">01 — DEMAND</span><h3>Discover buyer intent</h3><p>Monitor public RFQs, tenders, procurement notices and structured commercial demand with traceable evidence.</p></article>
          <article class="step"><span class="num">02 — SUPPLY</span><h3>Find lower-cost supply</h3><p>Match the exact product or specification across suppliers and jurisdictions without buying stock in advance.</p></article>
          <article class="step"><span class="num">03 — ECONOMICS</span><h3>Calculate the real spread</h3><p>Include unit cost, shipping, duties, tax, payment fees, insurance, reserves and lead time before calling anything profitable.</p></article>
          <article class="step"><span class="num">04 — VERIFY</span><h3>Reject weak deals</h3><p>Discard restricted goods, identity mismatches, inadequate margins, weak evidence, expired demand and unverified availability.</p></article>
          <article class="step"><span class="num">05 — FUND</span><h3>Secure buyer money first</h3><p>The supplier purchase is triggered only after buyer funding or approved escrow is secured under the transaction terms.</p></article>
          <article class="step"><span class="num">06 — EXECUTE</span><h3>Fulfil and retain margin</h3><p>Funds move through the transaction, supplier cost is paid, delivery is completed, and the remaining verified spread is the gross transaction margin.</p></article>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <p class="eyebrow">Hard gates</p>
          <div>
            <h2>Most “opportunities” are supposed to die.</h2>
            <p class="section-copy">XGuard is designed to reject attractive-looking deals unless the buyer, supplier, economics and legal constraints survive verification.</p>
          </div>
        </div>

        <div class="rules">
          <div class="rule"><span class="tick">✓</span><div><strong>Evidence-backed demand</strong><span>No invented buyers, no assumed willingness to pay.</span></div></div>
          <div class="rule"><span class="tick">✓</span><div><strong>Verified economics</strong><span>Revenue is never treated as profit; landed costs and reserves come first.</span></div></div>
          <div class="rule"><span class="tick">✓</span><div><strong>No inventory gamble</strong><span>XGuard does not buy products hoping a customer appears later.</span></div></div>
          <div class="rule"><span class="tick">✓</span><div><strong>Compliance before execution</strong><span>Restricted goods and unclear jurisdictions are rejected rather than routed around.</span></div></div>
        </div>

        <div class="note">Live operations are intentionally private. Public visitors can see what the engine is and whether it is active; buyer emails, supplier contacts and executable deal data stay behind the administrative boundary.</div>
      </section>

      <footer>
        <span>XGuard Global Commerce Engine</span>
        <span>Public demand → verified supply → funded transaction → margin</span>
      </footer>
    </div>
  </main>
</body>
</html>`;
}
