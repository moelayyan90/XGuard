const BRAND_CACHE = "public, max-age=31536000, immutable";
const XGUARD_LOGO_PNG_URL =
  "https://raw.githubusercontent.com/moelayyan90/XGuard/main/assets/xguard.png";

const XGUARD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title"><title id="title">XGuard</title><rect width="64" height="64" rx="14" fill="#f48120"/><path d="M32 13.5 47 19.2v12.4c0 9.4-5.7 15.2-15 19.7-9.3-4.5-15-10.3-15-19.7V19.2L32 13.5Z" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round"/><path d="m25.7 25.8 12.6 12.6m0-12.6L25.7 38.4" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>`;

const XGUARD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 104" role="img" aria-labelledby="title desc"><title id="title">XGuard</title><desc id="desc">XGuard orange shield mark and wordmark</desc><rect x="2" y="2" width="100" height="100" rx="23" fill="#f48120"/><path d="M52 22 76 31v20c0 15-9 24.4-24 31.5C37 75.4 28 66 28 51V31l24-9Z" fill="none" stroke="#fff" stroke-width="5.5" stroke-linejoin="round"/><path d="m42 41 20 20m0-20L42 61" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/><text x="128" y="69" fill="#202124" font-family="Segoe UI,Helvetica Neue,Arial,sans-serif" font-size="50" font-weight="650" letter-spacing="-2">XGuard</text></svg>`;

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
