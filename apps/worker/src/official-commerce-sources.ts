export interface OfficialCommerceSourceEnv {
  DB: D1Database;
}

export async function officialCommerceSourcesResponse(
  request: Request,
  env: OfficialCommerceSourceEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/v1/commerce/sources/status") return null;
  const counts = await env.DB.prepare(
    `SELECT source_name, COUNT(*) AS n, MAX(updated_at) AS last_updated_at
     FROM commerce_demands
     WHERE source_name IN ('UK Find a Tender','UK Contracts Finder','EU TED')
     GROUP BY source_name
     ORDER BY source_name`,
  ).all<Record<string, unknown>>();
  return Response.json({ sources: counts.results ?? [] });
}

export async function refreshOfficialCommerceSources(
  _env: OfficialCommerceSourceEnv,
): Promise<{ checked: number; imported: number; errors: string[] }> {
  return { checked: 0, imported: 0, errors: [] };
}
