import fs from "node:fs/promises";
import process from "node:process";

const samplePath = process.env.XGUARD_SAMPLE || ".xguard/transaction.json";
const api = process.env.XGUARD_API_URL || "https://api.xguardgate.com/v1/test";
const min = Number(process.env.XGUARD_MIN_SCORE || 90);

if (!Number.isFinite(min) || min < 0 || min > 100) {
  console.error("XGuard ATS-100: min-score must be between 0 and 100");
  process.exit(2);
}

let sample;
try {
  sample = JSON.parse(await fs.readFile(samplePath, "utf8"));
} catch (error) {
  console.error(`XGuard ATS-100: cannot read valid JSON from ${samplePath}: ${error.message}`);
  process.exit(2);
}

let response;
try {
  response = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "xguard-ats100-github-action/1.0" },
    body: JSON.stringify(sample),
    signal: AbortSignal.timeout(15000),
  });
} catch (error) {
  console.error(`XGuard ATS-100: test API unavailable: ${error.message}`);
  process.exit(2);
}

let report;
try { report = await response.json(); } catch { report = { error: "invalid_api_response" }; }
if (!response.ok) {
  console.error(`XGuard ATS-100: API error ${response.status}: ${JSON.stringify(report)}`);
  process.exit(2);
}

const score = Number(report.score);
const grade = String(report.grade || "?");
const protocol = String(report.protocol || "unknown");
console.log(`XGuard ATS-100: ${score}/100 (${grade}) · ${protocol}`);
for (const check of report.checks || []) {
  console.log(`${check.pass ? "PASS" : "GAP "} ${check.id}: ${check.earned}/${check.max} — ${check.detail}`);
}
for (const risk of report.risks || []) console.log(`RISK ${String(risk.severity || "").toUpperCase()} ${risk.code}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = (report.checks || []).map(c => `| ${c.id} | ${c.earned}/${c.max} | ${c.pass ? "PASS" : "GAP"} |`).join("\n");
  const risks = (report.risks || []).map(r => `- **${String(r.severity || "").toUpperCase()}** ${r.code}`).join("\n") || "- None detected in supplied sample";
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `# XGuard ATS-100\n\n**Score:** ${score}/100 (${grade})  \n**Protocol:** ${protocol}  \n**Required:** ${min}/100\n\n| Control | Score | Status |\n|---|---:|---|\n${rows}\n\n## Risk signals\n${risks}\n\nStructural runtime-readiness test only; not a certification.\n`);
}

if (!Number.isFinite(score) || score < min) {
  console.error(`XGuard ATS-100 gate failed: ${score}/100 is below required ${min}/100`);
  process.exit(1);
}

console.log(`XGuard ATS-100 gate passed: ${score}/100 >= ${min}/100`);
