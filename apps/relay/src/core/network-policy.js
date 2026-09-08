function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224 || (a === 192 && b === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function isPrivateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return false;
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = value;
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
    normalized = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return true;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(part => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : -1);
  if (words.length !== 8 || words.some(word => word < 0)) return true;
  const unspecified = words.every(word => word === 0);
  const loopback = words.slice(0, 7).every(word => word === 0) && words[7] === 1;
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (mapped) return isPrivateIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  const globalUnicast = (words[0] & 0xe000) === 0x2000;
  const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
  return unspecified || loopback || !globalUnicast || documentation;
}

function hostnameAllowed(hostname) {
  const host = String(hostname || "").replace(/\.$/, "").toLowerCase();
  if (!host || host.length > 253 || host === "localhost" || !host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || host.endsWith(".home") || host.endsWith(".lan")) return false;
  if (host === "metadata.google.internal" || host === "metadata.azure.internal" || host.endsWith(".xguardgate.com") || host === "xguardgate.com") return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
  return true;
}

async function publicDns(hostname) {
  if (!hostnameAllowed(hostname)) return { ok: false, code: "target_not_public" };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) return { ok: true, addresses: [hostname] };
  const answers = [];
  let trustedResponses = 0;
  let successfulFamilies = 0;
  let unavailableFamilies = 0;
  for (const type of ["A", "AAAA"]) {
    const resolvers = [
      { endpoint: "https://one.one.one.one/dns-query", accept: "application/dns-json", hosts: new Set(["one.one.one.one", "cloudflare-dns.com"]) },
      { endpoint: "https://cloudflare-dns.com/dns-query", accept: "application/dns-json", hosts: new Set(["cloudflare-dns.com", "one.one.one.one"]) },
      { endpoint: "https://dns.google/resolve", accept: "application/json", hosts: new Set(["dns.google"]) },
    ];
    const results = await Promise.allSettled(resolvers.map(async resolver => {
        const endpoint = new URL(resolver.endpoint);
        endpoint.searchParams.set("name", hostname);
        endpoint.searchParams.set("type", type);
        const response = await fetch(endpoint, { headers: { accept: resolver.accept }, signal: AbortSignal.timeout(2500), redirect: "follow" });
        if (!response.ok || !resolver.hosts.has(new URL(response.url || endpoint).hostname)) throw new Error("dns_resolver_unavailable");
        const candidate = await response.json().catch(() => null);
        if (!candidate || !Number.isInteger(Number(candidate.Status ?? 0))) throw new Error("dns_response_invalid");
        return candidate;
      }));
    const bodies = results.filter(result => result.status === "fulfilled").map(result => result.value);
    trustedResponses += bodies.length;
    const successful = bodies.filter(body => Number(body.Status ?? 0) === 0);
    if (successful.length) successfulFamilies += 1;
    else if (!bodies.length || bodies.some(body => ![0, 3].includes(Number(body.Status ?? 0)))) unavailableFamilies += 1;
    for (const body of successful) {
      for (const answer of Array.isArray(body?.Answer) ? body.Answer : []) {
        if (answer.type === 1 || answer.type === 28) answers.push(String(answer.data || ""));
      }
    }
  }
  if (!trustedResponses || unavailableFamilies) return { ok: false, code: "dns_unavailable" };
  if (successfulFamilies < 2) return { ok: false, code: "dns_unresolved" };
  if (!answers.length || answers.some(address => isPrivateIpv4(address) || isPrivateIpv6(address))) return { ok: false, code: answers.length ? "target_not_public" : "dns_unresolved" };
  return { ok: true, addresses: [...new Set(answers)] };
}


export { isPrivateIpv4, isPrivateIpv6, hostnameAllowed, publicDns };
