[CmdletBinding()]
param(
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "XGuard Cloudflare testnet deploy" -ForegroundColor Cyan
Write-Host "Uses existing Cloudflare authorization when available and never stores credentials in the repository." -ForegroundColor DarkGray

Set-Location -LiteralPath $PSScriptRoot

$PublicConfigPath = "apps/worker/wrangler.jsonc"
$LocalConfigPath = "apps/worker/wrangler.local.jsonc"
$ResolvedConfigPath = $null
$ConfigPath = $null
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

    $HasApiToken = -not [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)
    if (-not $HasApiToken) {
        & npx wrangler whoami *> $null
        $HasWranglerSession = ($LASTEXITCODE -eq 0)

        if (-not $HasWranglerSession) {
            if ($NonInteractive) {
                throw "Cloudflare authorization is unavailable in this environment. The existing live deployment was not changed."
            }

            $SecureToken = Read-Host "Paste the Cloudflare XGuard-Deploy token, then press Enter" -AsSecureString
            $BSTR = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
            $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($BSTR)
            if ([string]::IsNullOrWhiteSpace($PlainToken)) { throw "No token was entered." }
            $env:CLOUDFLARE_API_TOKEN = $PlainToken
            $PromptedForToken = $true
        }
    }

    if (Test-Path -LiteralPath $LocalConfigPath) {
        $ConfigPath = $LocalConfigPath
        Write-Host "Using authorized local Wrangler configuration." -ForegroundColor Green
    } else {
        $ResolvedConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) ("xguard-wrangler-" + [guid]::NewGuid().ToString("N") + ".jsonc")
        Write-Host "Resolving the existing Cloudflare D1 binding automatically..." -ForegroundColor Cyan
        & node "scripts/resolve-cloudflare-config.mjs" --template $PublicConfigPath --output $ResolvedConfigPath --database-name "xguard-testnet"
        if ($LASTEXITCODE -ne 0) { throw "Could not resolve the existing xguard-testnet D1 database." }
        $ConfigPath = $ResolvedConfigPath
    }

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
                throw ("Post-deploy check failed for {0}: {1}" -f $Path, $_.Exception.Message)
            }
        }
    } else {
        throw "Deployment completed but the permanent workers.dev URL could not be verified from Wrangler output."
    }

    Write-Host ""
    Write-Host "XGuard testnet deployment completed and verified." -ForegroundColor Cyan
}
finally {
    if ($ResolvedConfigPath -and (Test-Path -LiteralPath $ResolvedConfigPath)) {
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
