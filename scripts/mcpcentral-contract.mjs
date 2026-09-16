export function inspectMirror(manifest, mirror) {
  const endpoint = manifest.remotes.find(remote => remote.type === "streamable-http").url;
  const server = mirror.server ?? mirror.data?.server ?? mirror.data ?? mirror;
  const registered = server.raw ?? server;
  const observed_version = registered.version ?? server.version ?? null;
  const name_matches = [server.id, server.name, registered.name].includes(manifest.name);
  const remotes = registered.remotes ?? server.remotes;
  const endpoint_matches = Array.isArray(remotes) && remotes.some(remote => remote.type === "streamable-http" && remote.url === endpoint);
  return { observed_version, name_matches, endpoint_matches,
    mirror_verified: name_matches && observed_version === manifest.version && endpoint_matches };
}
