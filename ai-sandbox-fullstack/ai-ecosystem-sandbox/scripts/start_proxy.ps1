<#
.SYNOPSIS
  Start the nginx reverse proxy in front of the CSI Nora + AI sandbox stack.

.DESCRIPTION
  Prod mode (default): builds the Angular SPA and serves it statically at /,
  routing APIs by path prefix.
  Dev mode: proxies / to the live `ng serve` dev server (no build needed).

.EXAMPLE
  .\scripts\start_proxy.ps1                 # prod: build + serve on http://localhost
  .\scripts\start_proxy.ps1 -Port 8080      # publish on a different port
  .\scripts\start_proxy.ps1 -Mode dev       # dev: proxy to ng serve :4200
  .\scripts\start_proxy.ps1 -SkipBuild      # prod without rebuilding the SPA
#>
param(
    [ValidateSet('prod', 'dev')]
    [string]$Mode = 'prod',
    [int]$Port = 80,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$sandboxDir = Split-Path -Parent $PSScriptRoot
$noraDir    = Join-Path (Split-Path -Parent $sandboxDir) 'csi-nora-v2'
$env:PROXY_HTTP_PORT = "$Port"

Push-Location $sandboxDir
try {
    if ($Mode -eq 'prod') {
        if (-not $SkipBuild) {
            Write-Host "Building CSI Nora UI (production)..." -ForegroundColor Cyan
            Push-Location $noraDir
            try {
                if (-not (Test-Path 'node_modules')) { npm install }
                npm run build
            } finally { Pop-Location }
        }
        $dist = Join-Path $noraDir 'dist\csi-nora\browser'
        if (-not (Test-Path (Join-Path $dist 'index.html'))) {
            throw "Built SPA not found at $dist. Run without -SkipBuild, or check the Angular outputPath."
        }
        Write-Host "Starting full stack (prod: infra + bridge + streamlit + proxy)..." -ForegroundColor Cyan
        docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
    }
    else {
        Write-Host "Starting reverse proxy (dev, proxies to ng serve :4200)..." -ForegroundColor Cyan
        Write-Host "Make sure 'npm start' is running in csi-nora-v2." -ForegroundColor Yellow
        docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy
    }

    Write-Host ""
    Write-Host "Reverse proxy is up:" -ForegroundColor Green
    Write-Host "  UI        : http://localhost:$Port/"
    Write-Host "  Ollama    : http://localhost:$Port/ollama/"
    Write-Host "  Bridge    : http://localhost:$Port/sandbox/   (run bridge on host :8090)"
    Write-Host "  Streamlit : http://localhost:$Port/streamlit/ (run with --server.baseUrlPath=streamlit)"
    Write-Host "  Health    : http://localhost:$Port/healthz"
}
finally {
    Pop-Location
}
