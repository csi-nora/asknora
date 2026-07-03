<#
.SYNOPSIS
  Start ngrok OR Cloudflare Tunnel (cloudflared) to expose local CSI Nora — default nginx port 8090.

.EXAMPLE
  .\scripts\tunnel.ps1 -Provider Ngrok
  .\scripts\tunnel.ps1 -Provider Cloudflare
  .\scripts\tunnel.ps1 -Provider Ngrok -Port 4200
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Ngrok', 'Cloudflare')]
    [string] $Provider,

    [int] $Port = 8090
)

$ErrorActionPreference = 'Stop'
$target = "http://127.0.0.1:$Port"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "[tunnel] Provider: $Provider  |  Local target: $target"
Write-Host "[tunnel] Ensure nginx (or ng serve) is listening on port $Port — see docs/TUNNEL-NGROK-CLOUDFLARE.md"
Write-Host ""

if ($Provider -eq 'Ngrok') {
    if (-not (Test-Command 'ngrok')) {
        Write-Error "ngrok not found in PATH. Install: https://ngrok.com/download  OR  npm install -g ngrok  Then: ngrok config add-authtoken YOUR_TOKEN"
    }
    & ngrok http $Port
    exit $LASTEXITCODE
}

if ($Provider -eq 'Cloudflare') {
    if (-not (Test-Command 'cloudflared')) {
        Write-Error "cloudflared not found in PATH. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/#windows  OR  winget install --id Cloudflare.cloudflared"
    }
    & cloudflared tunnel --url $target
    exit $LASTEXITCODE
}
