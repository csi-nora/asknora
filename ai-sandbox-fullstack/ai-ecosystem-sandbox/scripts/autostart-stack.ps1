<#
  CSI Nora — auto-start the full stack after a Windows boot / logon.

  Waits for the Docker engine to become ready (Docker Desktop on the WSL2 backend
  can take a while), then brings up the reverse-proxy stack. Idempotent:
  `docker compose up -d` is a no-op for containers that are already running, and
  `restart: unless-stopped` in the compose files means Docker itself relaunches
  them once the engine is up — this script is the belt-and-suspenders guarantee.

  Intended to be registered as a Scheduled Task at logon (see setup-autostart.ps1).
  Logs to ai-ecosystem-sandbox/autostart-stack.log.
#>
[CmdletBinding()]
param(
  [int]$TimeoutSeconds = 600,
  [string]$Port = '9090'
)

$ErrorActionPreference = 'Continue'
$sandboxDir = Split-Path -Parent $PSScriptRoot   # ...\ai-ecosystem-sandbox
$log = Join-Path $sandboxDir 'autostart-stack.log'
function Log($m) { "$(Get-Date -Format o)  $m" | Tee-Object -FilePath $log -Append | Out-Null; Write-Host $m }

Log "=== autostart-stack starting (dir=$sandboxDir, port=$Port) ==="

# 1) Launch Docker Desktop if it isn't running (WSL2 backend needs a user session).
$dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if ((Test-Path $dockerDesktop) -and -not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
  Log "Launching Docker Desktop..."
  Start-Process $dockerDesktop | Out-Null
}

# 2) Wait until the Docker engine answers.
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

& docker info *> $null
if ($LASTEXITCODE -ne 0) { Log "ERROR: Docker engine not ready after ${TimeoutSeconds}s. Aborting."; exit 1 }
Log "Docker engine is ready."

# 3) Bring the stack up (idempotent).
Push-Location $sandboxDir
try {
  $env:PROXY_HTTP_PORT = $Port
  Log "docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d ..."
  & docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d 2>&1 | Tee-Object -FilePath $log -Append
  Log "compose up exit code = $LASTEXITCODE"
} finally { Pop-Location }

Log "=== autostart-stack done. UI: http://localhost:$Port/  (LAN: http://<LAN-IP>:$Port/) ==="
