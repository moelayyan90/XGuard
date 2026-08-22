# XGuard Security Rewards

XGuard's Security Reward Miner is a public-source-only pipeline for identifying high-signal security candidates in repositories that are explicitly covered by published reward programs.

## Revenue path

The primary external programs are:

1. Google Open Source Software Vulnerability Reward Program (OSS VRP).
2. Google Open Source Security Patch Rewards.

The miner reads the current official program scope directly from `google/bughunters` on every run instead of keeping a stale local allowlist.

## Safety boundary

The miner intentionally does **not**:

- scan live websites or production infrastructure;
- exploit a suspected vulnerability;
- access private data, secrets, accounts, or non-public systems;
- submit vulnerability reports automatically;
- claim that a heuristic finding is a vulnerability;
- operate on a repository unless it appears in the current official reward-program scope sources.

It performs source/configuration inspection only and emits candidates for validation. Any report must satisfy the current program rules, contain reproducible evidence, and avoid impact to users or infrastructure.

## Why submissions are not automatic

Reward programs pay for validated security impact, not scanner output. Google explicitly requires high-quality, reproducible evidence and has tightened rules in response to low-quality AI-generated submissions. Automatic submission of heuristic findings would create invalid reports and can damage researcher standing.

## Output

A run writes:

- `artifacts/security-reward-candidates/candidates.json`
- `artifacts/security-reward-candidates/candidates.md`

Candidates are ranked by confidence and reward-program relevance. High-confidence checks currently focus on supply-chain patterns in GitHub Actions, such as privileged `pull_request_target` workflows that execute attacker-controlled code or interpolate attacker-controlled PR data into shell steps.

## Daily automation

`.github/workflows/security-reward-miner.yml` runs once per day and can also be triggered manually. It downloads the current official scope, inspects public workflow configuration, and uploads the ranked candidate evidence as a GitHub Actions artifact.

## Bank payout route

For Google Bug Hunters, Bugcrowd is an available payout option. Bugcrowd supports bank transfer. The bank account, identity verification, and tax information belong in the researcher's Bugcrowd account, not in XGuard source code, GitHub Actions secrets, logs, or artifacts.

## Revenue target

No bounty or patch-reward program guarantees a daily amount. A target of USD 400/day is USD 12,000 per 30-day month. Google Patch Rewards currently has a maximum of three rewards per month per individual submitter, so the revenue target depends on producing a small number of genuinely high-impact accepted patches or vulnerabilities rather than high-volume low-quality reports.
