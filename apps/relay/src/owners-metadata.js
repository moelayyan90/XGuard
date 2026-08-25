const OWNERS_METADATA = Object.freeze({
  version: 1,
  server: "https://api.xguardgate.com/mcp",
  repository: "https://github.com/moelayyan90/XGuard",
  owners: [
    {
      name: "moelayyan90",
      type: "individual",
      url: "https://github.com/moelayyan90",
      repository: "https://github.com/moelayyan90/XGuard"
    }
  ]
});

export function ownersMetadataResponse() {
  return new Response(JSON.stringify(OWNERS_METADATA), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
}

export default OWNERS_METADATA;
