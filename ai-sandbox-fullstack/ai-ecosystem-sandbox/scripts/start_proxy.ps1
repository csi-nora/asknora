<#
.SYNOPSIS
  Start the nginx reverse proxy in front of the CSI Nora + AI sandbox stack.

.DESCRIPTION
  Prod mode (default): builds the Angular SPA and serves it statically at /,
  routing APIs by path prefix. By DEFAULT the proxy binds 0.0.0.0:9090 so it is
  reachable from other hosts on the LAN (http://<LAN-IP>:9090/).
  Dev mode: proxies / to the live `ng serve` dev server (no build needed).

.EXAMPLE
  .\scripts\start_proxy.ps1                 # prod: build + serve on 0.0.0.0:9090
  .\scripts\start_proxy.ps1 -Port 8080      # publish on a different port
  .\scripts\start_proxy.ps1 -Mode dev       # dev: proxy to ng serve :4200
  .\scripts\start_proxy.ps1 -SkipBuild      # prod without rebuilding the SPA
  $env:PROXY_BIND_HOST='127.0.0.1'; .\scripts\start_proxy.ps1  # localhost only
#>
param(
    [ValidateSet('prod', 'dev')]
    [string]$Mode = 'prod',
    [int]$Port = 9090,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$sandboxDir = Split-Path -Parent $PSScriptRoot
$noraDir    = Join-Path (Split-Path -Parent $sandboxDir) 'csi-nora-v2'
$env:PROXY_HTTP_PORT = "$Port"
if (-not $env:PROXY_BIND_HOST) { $env:PROXY_BIND_HOST = '0.0.0.0' }

function Get-LanIPv4 {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.PrefixOrigin -ne 'WellKnown' -and
                $_.InterfaceAlias -notmatch 'vEthernet|WSL|VMware|Hyper-V|Loopback|Virtual'
            } |
            Sort-Object -Property InterfaceMetric |
            Select-Object -ExpandProperty IPAddress -First 1
    } catch { $null }
}

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
        Write-Host "Starting full stack (prod: bind $($env:PROXY_BIND_HOST):$Port)..." -ForegroundColor Cyan
        docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build --remove-orphans
    }
    else {
        Write-Host "Starting reverse proxy (dev, proxies to ng serve :4200)..." -ForegroundColor Cyan
        Write-Host "Make sure 'npm start' is running in csi-nora-v2." -ForegroundColor Yellow
        docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy
    }

    $lan = Get-LanIPv4
    Write-Host ""
    Write-Host "Reverse proxy is up (LAN bind $($env:PROXY_BIND_HOST):$Port):" -ForegroundColor Green
    Write-Host "  Local     : http://localhost:$Port/"
    if ($lan) {
        Write-Host "  LAN       : http://${lan}:$Port/     <-- share this URL" -ForegroundColor Yellow
    } else {
        Write-Host "  LAN       : http://<your-LAN-IP>:$Port/   (run 'ipconfig' to find it)"
    }
    Write-Host "  Ollama    : http://localhost:$Port/ollama/"
    Write-Host "  Bridge    : http://localhost:$Port/sandbox/"
    Write-Host "  Streamlit : http://localhost:$Port/streamlit/"
    Write-Host "  Health    : http://localhost:$Port/healthz"
}
finally {
    Pop-Location
}
