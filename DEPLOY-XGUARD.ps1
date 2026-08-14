$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "XGuard Cloudflare testnet deploy" -ForegroundColor Cyan
Write-Host "This script never stores your Cloudflare token in the project." -ForegroundColor DarkGray

# Always work from the folder containing this script.
Set-Location -LiteralPath $PSScriptRoot

# The public config is safe to commit. The ignored local config keeps the
# currently authorized Cloudflare account and D1 identifiers off GitHub.
$LocalConfigPath = "apps/worker/wrangler.local.jsonc"
$ConfigPath = if (Test-Path -LiteralPath $LocalConfigPath) {
    $LocalConfigPath
} else {
    "apps/worker/wrangler.jsonc"
}

# Basic local prerequisites.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed. XGuard requires Node.js 22 or newer."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not available. Install Node.js 22 or newer first."
}

$NodeVersionText = (& node -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersionText.Split('.')[0])
if ($NodeMajor -lt 22) {
    throw "Node.js $NodeVersionText is installed, but XGuard requires Node.js 22 or newer."
}
Write-Host "Node.js $NodeVersionText OK" -ForegroundColor Green

# Ask for token without echoing it on screen.
$SecureToken = Read-Host "Paste the Cloudflare XGuard-Deploy token, then press Enter" -AsSecureString
$BSTR = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($BSTR)
    if ([string]::IsNullOrWhiteSpace($PlainToken)) { throw "No token was entered." }

    $env:CLOUDFLARE_API_TOKEN = $PlainToken
    Write-Host "Installing locked dependencies..." -ForegroundColor Cyan
    & npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

    Write-Host "Running Cloudflare type/config validation..." -ForegroundColor Cyan
    & npx wrangler types --config $ConfigPath --env-interface CloudflareBindings
    if ($LASTEXITCODE -ne 0) { throw "Wrangler configuration validation failed." }

    Write-Host "Applying D1 migrations to xguard-testnet..." -ForegroundColor Cyan
    & npx wrangler d1 migrations apply xguard-testnet --remote --config $ConfigPath
    if ($LASTEXITCODE -ne 0) { throw "D1 migration failed." }

    Write-Host "Deploying XGuard Worker..." -ForegroundColor Cyan
    $DeployOutput = (& npx wrangler deploy --config $ConfigPath 2>&1 | Tee-Object -Variable DeployLines)
    $ExitCode = $LASTEXITCODE
    $DeployOutput | ForEach-Object { Write-Host $_ }
    if ($ExitCode -ne 0) { throw "Cloudflare deployment failed." }

    $Joined = ($DeployLines | Out-String)
    $Match = [regex]::Match($Joined, 'https://[^\s]+\.workers\.dev')
    if ($Match.Success) {
        $BaseUrl = $Match.Value.TrimEnd('/')
        Write-Host ""
        Write-Host "DEPLOYED: $BaseUrl" -ForegroundColor Green
        foreach ($Path in @('/healthz','/readyz','/supported','/status')) {
            try {
                $Response = Invoke-WebRequest -Uri ($BaseUrl + $Path) -Method GET -UseBasicParsing -TimeoutSec 30
                Write-Host ("PASS {0} -> HTTP {1}" -f $Path, $Response.StatusCode) -ForegroundColor Green
            } catch {
                Write-Host ("CHECK {0} -> {1}" -f $Path, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "Deployment completed, but the workers.dev URL was not parsed automatically. Copy it from the deploy output above." -ForegroundColor Yellow
    }
}
finally {
    if ($BSTR -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    }
    Remove-Variable PlainToken -ErrorAction SilentlyContinue
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. You can close this window after copying the final XGuard URL." -ForegroundColor Cyan
Read-Host "Press Enter to close"
