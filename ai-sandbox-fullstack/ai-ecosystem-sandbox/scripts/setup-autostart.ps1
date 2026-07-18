<#
  CSI Nora — one-time persistent-deployment setup (run ONCE, ELEVATED / Admin).

  Makes the stack come back automatically after a Windows reboot:
    1. Creates the LAN firewall rule (inbound TCP <Port>).
    2. Registers a Scheduled Task that runs autostart-stack.ps1 at every logon,
       which waits for the Docker engine and brings the stack up.
    3. Reminds you to enable Docker Desktop "Start Docker Desktop when you sign in".

  Idempotent: re-running updates the task/rule in place (-Force).
#>
[CmdletBinding()]
param(
  [int]$Port = 9090,
  [string]$TaskName = 'CSI Nora Stack Autostart'
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this in an elevated (Administrator) PowerShell."
}

$here      = $PSScriptRoot
$autostart = Join-Path $here 'autostart-stack.ps1'
if (-not (Test-Path $autostart)) { throw "Cannot find $autostart" }

# 1) Firewall rule (idempotent)
& (Join-Path $here 'enable-lan-firewall.ps1') -Port $Port

# 2) Scheduled Task — run at logon for the current user, highest privileges.
#    (Docker Desktop's WSL2 backend needs an interactive user session, so "at logon"
#     is the reliable trigger. See notes below for a fully headless alternative.)
$user      = "$env:USERDOMAIN\$env:USERNAME"
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$autostart`" -Port $Port"
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task '$TaskName' (At logon, RunLevel Highest)."

Write-Host ""
Write-Host "==================================================================="
Write-Host " MANUAL STEPS (one time):"
Write-Host "  1. Docker Desktop -> Settings -> General ->"
Write-Host "     [x] Start Docker Desktop when you sign in   (then Apply & Restart)"
Write-Host "  2. Recommended: set a DHCP reservation / static IP for this host so"
Write-Host "     the shared URL http://<LAN-IP>:$Port/ stays constant after reboot."
Write-Host "==================================================================="
