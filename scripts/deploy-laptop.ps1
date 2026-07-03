<#
.SYNOPSIS
  Build CSI Nora for a public origin (npm run build:vm) and copy browser output to a deploy folder for nginx.

.EXAMPLE
  .\scripts\deploy-laptop.ps1 -PublicOrigin "http://66.249.73.198:8090" -DeployRoot "C:\csi-nora-deploy\browser"
#>
param(
    [Parameter(Mandatory = $false)]
    [string] $PublicOrigin = "http://66.249.73.198:8090",

    [Parameter(Mandatory = $false)]
    [string] $DeployRoot = "C:\csi-nora-deploy\browser"
)

$ErrorActionPreference = "Stop"
# PSScriptRoot = .../csi-nora/scripts  → project root = csi-nora
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[deploy-laptop] Project root: $root"
Write-Host "[deploy-laptop] CSI_NORA_PUBLIC_ORIGIN=$PublicOrigin"
$env:CSI_NORA_PUBLIC_ORIGIN = $PublicOrigin

npm run build:vm
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$src = Join-Path $root "dist\csi-nora\browser"
if (-not (Test-Path $src)) {
    Write-Error "Missing build output: $src"
}

New-Item -ItemType Directory -Force -Path $DeployRoot | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $DeployRoot -Recurse -Force

Write-Host ""
Write-Host "[deploy-laptop] Deployed to: $DeployRoot"
Write-Host "[deploy-laptop] Set nginx root to (forward slashes): $($DeployRoot -replace '\\','/')"
Write-Host "[deploy-laptop] Then run: npm run gateway   (keep open; proxies /api on port 3456)"
Write-Host ""
