const BRAND_CACHE = "public, max-age=31536000, immutable";
const RAW_ASSET_BASE = "https://raw.githubusercontent.com/moelayyan90/XGuard/main/assets";
const XGUARD_LOGO_PNG_URL = `${RAW_ASSET_BASE}/xguard.png`;
const XGUARD_MARK_PNG_URL = `${RAW_ASSET_BASE}/xguard-mark.png`;

const XGUARD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72" role="img" aria-labelledby="title desc"><title id="title">XGuard</title><desc id="desc">XGuard angular mark</desc><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4d7d9"/><stop offset="1" stop-color="#91999e"/></linearGradient><linearGradient id="t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5ec2cc"/><stop offset="1" stop-color="#557f87"/></linearGradient></defs><path d="M2 3h20l22 22L65 3h53l-12 12H71L52 34l31 31H61L2 6Z" fill="url(#s)"/><path d="M73 28h39v39H82V54h16V42H84Z" fill="url(#s)"/><path d="M3 68 23 48l13 13-8 7Z" fill="url(#t)"/></svg>`;

const XGUARD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 190" role="img" aria-labelledby="title desc"><title id="title">XGuard</title><desc id="desc">XGuard wordmark</desc><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4d7d9"/><stop offset="1" stop-color="#91999e"/></linearGradient><linearGradient id="t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5ec2cc"/><stop offset="1" stop-color="#557f87"/></linearGradient></defs><g transform="translate(70 8) scale(2.85)"><path d="M2 3h20l22 22L65 3h53l-12 12H71L52 34l31 31H61L2 6Z" fill="url(#s)"/><path d="M73 28h39v39H82V54h16V42H84Z" fill="url(#s)"/><path d="M3 68 23 48l13 13-8 7Z" fill="url(#t)"/></g><text x="280" y="176" text-anchor="middle" fill="url(#s)" font-family="Arial,Helvetica,sans-serif" font-size="54" font-weight="800" letter-spacing="4">XGUARD</text></svg>`;

export function mainnetBrandingResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);

  if (url.pathname === "/favicon.ico") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/favicon.svg`,
        "Cache-Control": BRAND_CACHE,
      },
    });
  }

  if (url.pathname === "/favicon.svg")
    return svgResponse(XGUARD_MARK_SVG, request.method === "HEAD");

  if (url.pathname === "/logo.svg" || url.pathname === "/xguard-logo.svg")
    return svgResponse(XGUARD_LOGO_SVG, request.method === "HEAD");

  if (url.pathname === "/logo.png" || url.pathname === "/xguard-logo.png")
    return redirectResponse(XGUARD_LOGO_PNG_URL);

  if (url.pathname === "/brand-mark.png" || url.pathname === "/xguard-mark.png")
    return redirectResponse(XGUARD_MARK_PNG_URL);

  return null;
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": BRAND_CACHE,
    },
  });
}

function svgResponse(svg: string, headOnly: boolean): Response {
  return new Response(headOnly ? null : svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": BRAND_CACHE,
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
