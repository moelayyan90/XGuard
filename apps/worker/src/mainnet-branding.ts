const BRAND_CACHE = "public, max-age=31536000, immutable";
const XGUARD_LOGO_PNG_URL =
  "https://raw.githubusercontent.com/moelayyan90/XGuard/main/assets/xguard.png";

const XGUARD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title"><title id="title">XGuard</title><rect x="1" y="1" width="62" height="62" rx="15" fill="#111827"/><path d="M23 23 41 41M41 23 23 41" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`;

const XGUARD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 104" role="img" aria-labelledby="title desc"><title id="title">XGuard</title><desc id="desc">XGuard wordmark</desc><rect x="2" y="2" width="100" height="100" rx="24" fill="#111827"/><path d="M35 35 69 69M69 35 35 69" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><text x="128" y="69" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif" font-size="50" font-weight="650" letter-spacing="-2">XGuard</text></svg>`;

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
    return new Response(null, {
      status: 302,
      headers: {
        Location: XGUARD_LOGO_PNG_URL,
        "Cache-Control": BRAND_CACHE,
      },
    });

  return null;
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
