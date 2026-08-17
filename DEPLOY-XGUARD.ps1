[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [switch]$ConfirmMainnet
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $ConfirmMainnet) {
    throw "Refusing deployment. Re-run with -ConfirmMainnet to explicitly target the production xguard-mainnet Worker."
}

Write-Host "XGuard Cloudflare MAINNET deploy" -ForegroundColor Cyan
Write-Host "Target is hard-locked to xguard-mainnet. This script never deploys testnet." -ForegroundColor DarkGray

Set-Location -LiteralPath $PSScriptRoot

$TemplateConfigPath = "apps/worker/wrangler.mainnet.jsonc"
$ResolvedConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) ("xguard-mainnet-wrangler-" + [guid]::NewGuid().ToString("N") + ".jsonc")
$ExpectedBaseUrl = "https://xguardgate.com"
$PromptedForToken = $false
$BSTR = [IntPtr]::Zero

try {
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

    Write-Host "Installing locked dependencies..." -ForegroundColor Cyan
    & npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

    Write-Host "Validating the complete release candidate..." -ForegroundColor Cyan
    & npm run verify:release
    if ($LASTEXITCODE -ne 0) { throw "verify:release failed; mainnet was not changed." }

    $HasApiToken = -not [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)
    if (-not $HasApiToken) {
        & npx wrangler whoami *> $null
        $HasWranglerSession = ($LASTEXITCODE -eq 0)

        if (-not $HasWranglerSession) {
            if ($NonInteractive) {
                throw "Cloudflare authorization is unavailable. xguard-mainnet was not changed."
            }

            $SecureToken = Read-Host "Paste the Cloudflare XGuard mainnet deploy token, then press Enter" -AsSecureString
            $BSTR = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
            $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($BSTR)
            if ([string]::IsNullOrWhiteSpace($PlainToken)) { throw "No token was entered." }
            $env:CLOUDFLARE_API_TOKEN = $PlainToken
            $PromptedForToken = $true
        }
    }

    Write-Host "Resolving the production D1 binding..." -ForegroundColor Cyan
    & node "scripts/resolve-cloudflare-config.mjs" --template $TemplateConfigPath --output $ResolvedConfigPath --database-name "xguard-mainnet"
    if ($LASTEXITCODE -ne 0) { throw "Could not resolve the existing xguard-mainnet D1 database." }

    $ResolvedConfig = Get-Content -LiteralPath $ResolvedConfigPath -Raw
    if ($ResolvedConfig -notmatch '"name"\s*:\s*"xguard-mainnet"') {
        throw "Refusing deployment: Worker target is not xguard-mainnet."
    }
    if ($ResolvedConfig -notmatch '"main"\s*:\s*"src/mainnet-modern\.ts"') {
        throw "Refusing deployment: entrypoint is not src/mainnet-modern.ts."
    }
    if ($ResolvedConfig -notmatch '"database_name"\s*:\s*"xguard-mainnet"') {
        throw "Refusing deployment: D1 target is not xguard-mainnet."
    }
    if ($ResolvedConfig -notmatch '"XGUARD_TREASURY_USDC_ADDRESS"\s*:\s*"0x[0-9a-fA-F]{40}"') {
        throw "Refusing deployment: mainnet treasury address is missing or invalid."
    }

    Write-Host "Running Cloudflare type/config validation..." -ForegroundColor Cyan
    & npx wrangler types --config $ResolvedConfigPath --env-interface CloudflareBindings
    if ($LASTEXITCODE -ne 0) { throw "Wrangler configuration validation failed." }

    Write-Host "Applying D1 migrations to xguard-mainnet..." -ForegroundColor Cyan
    & npx wrangler d1 migrations apply xguard-mainnet --remote --config $ResolvedConfigPath
    if ($LASTEXITCODE -ne 0) { throw "Mainnet D1 migration failed." }

    Write-Host "Deploying xguard-mainnet..." -ForegroundColor Cyan
    $DeployOutput = (& npx wrangler deploy --config $ResolvedConfigPath 2>&1 | Tee-Object -Variable DeployLines)
    $ExitCode = $LASTEXITCODE
    $DeployOutput | ForEach-Object { Write-Host $_ }
    if ($ExitCode -ne 0) { throw "Cloudflare mainnet deployment failed." }

    $Joined = ($DeployLines | Out-String)
    if ($Joined -notmatch [regex]::Escape($ExpectedBaseUrl)) {
        throw "Deployment output did not confirm the expected xguard-mainnet workers.dev URL."
    }

    foreach ($Path in @('/healthz','/readyz','/supported','/status')) {
        try {
            $Response = Invoke-WebRequest -Uri ($ExpectedBaseUrl + $Path) -Method GET -UseBasicParsing -TimeoutSec 30
            Write-Host ("PASS {0} -> HTTP {1}" -f $Path, $Response.StatusCode) -ForegroundColor Green
        } catch {
            throw ("Post-deploy mainnet check failed for {0}: {1}" -f $Path, $_.Exception.Message)
        }
    }

    Write-Host "Running canonical live mainnet smoke..." -ForegroundColor Cyan
    & npm run smoke:mainnet
    if ($LASTEXITCODE -ne 0) { throw "Canonical mainnet smoke failed after deployment." }

    Write-Host ""
    Write-Host "XGuard MAINNET deployment completed and verified: $ExpectedBaseUrl" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $ResolvedConfigPath) {
        Remove-Item -LiteralPath $ResolvedConfigPath -Force -ErrorAction SilentlyContinue
    }
    if ($BSTR -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    }
    Remove-Variable PlainToken -ErrorAction SilentlyContinue
    if ($PromptedForToken) {
        Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    }
}

if (-not $NonInteractive) {
    Read-Host "Press Enter to close"
}
