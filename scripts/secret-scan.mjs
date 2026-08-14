import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import fg from "fast-glob";

const files = await fg(["**/*", ".env*", ".github/**/*"], {
  onlyFiles: true,
  dot: true,
  ignore: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "**/.git/**",
    "package-lock.json",
  ],
});
const patterns = [
  ["private key PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "seed phrase assignment",
    /(?:seed|mnemonic)[_-]?(?:phrase)?\s*[:=]\s*["'][a-z]+(?:\s+[a-z]+){11,23}["']/i,
  ],
  [
    "EVM private key assignment",
    /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*["']?0x[0-9a-f]{64}["']?/i,
  ],
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9_]{30,}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["live XGuard key", /\bxg_live_[A-Za-z0-9_-]{32,}\b/],
  ["Jordan IBAN", /\bJO[0-9]{2}[A-Z]{4}[A-Z0-9]{18,30}\b/],
];
const findings = [];
const trackedResult = spawnSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
});
const trackedFiles = new Set(
  trackedResult.status === 0 && trackedResult.stdout.length > 0
    ? trackedResult.stdout.split("\0").filter(Boolean)
    : [],
);
for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? normalized;
  const localSecretFile =
    (basename.startsWith(".env") && basename !== ".env.example") ||
    basename === ".dev.vars" ||
    /^\.xguard.*\.env$/i.test(basename);
  if (localSecretFile) {
    if (trackedFiles.has(normalized))
      findings.push(`${file}: environment secret file is tracked by git`);
    continue;
  }
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null || text.includes("\u0000")) continue;
  for (const [name, pattern] of patterns)
    if (pattern.test(text)) findings.push(`${file}: possible ${name}`);
}
if (findings.length > 0) {
  console.error(
    ["Secret scan failed (values intentionally hidden):", ...findings].join(
      "\n",
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed (${files.length} files inspected; values never printed).`,
  );
}
