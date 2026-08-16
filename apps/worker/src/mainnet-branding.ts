const BRAND_CACHE = "public, max-age=31536000, immutable";

const XGUARD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title"><title id="title">XGuard</title><rect width="512" height="512" fill="#ff1017"/><path d="M256 56 397 101c11 4 18 14 18 26v119c0 91-57 145-159 188-102-43-159-97-159-188V127c0-12 7-22 18-26L256 56Z" fill="#050505"/><path d="M256 74 383 115c6 2 10 8 10 14v113c0 77-48 123-137 163-89-40-137-86-137-163V129c0-6 4-12 10-14L256 74Z" fill="none" stroke="#fff" stroke-width="22" stroke-linejoin="round"/><text x="181" y="309" fill="#fff" font-family="Arial Black,Segoe UI Black,sans-serif" font-size="192" font-weight="900" transform="skewX(-7)">X</text><text x="246" y="309" fill="#fff" font-family="Arial Black,Segoe UI Black,sans-serif" font-size="188" font-weight="900">G</text></svg>`;

const XGUARD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" role="img" aria-labelledby="title desc"><title id="title">XGuard</title><desc id="desc">Official XGuard shield and wordmark on red</desc><rect width="1254" height="1254" fill="#ff1017"/><path d="M627 155 930 252c24 8 39 30 39 55v255c0 196-122 312-342 405-220-93-342-209-342-405V307c0-25 15-47 39-55L627 155Z" fill="#050505"/><path d="M627 194 899 281c13 4 21 16 21 30v242c0 165-102 264-293 349-191-85-293-184-293-349V311c0-14 8-26 21-30L627 194Z" fill="none" stroke="#fff" stroke-width="48" stroke-linejoin="round"/><text x="470" y="700" fill="#fff" font-family="Arial Black,Segoe UI Black,sans-serif" font-size="420" font-weight="900" transform="skewX(-7)">X</text><text x="610" y="700" fill="#fff" font-family="Arial Black,Segoe UI Black,sans-serif" font-size="410" font-weight="900">G</text><text x="627" y="1110" text-anchor="middle" fill="#fff" font-family="Arial Black,Segoe UI Black,Eurostile,sans-serif" font-size="132" font-weight="900" letter-spacing="9">XGUARD</text></svg>`;

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
