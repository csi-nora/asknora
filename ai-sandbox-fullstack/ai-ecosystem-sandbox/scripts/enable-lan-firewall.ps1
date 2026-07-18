<#
  Idempotent Windows Firewall helper — allow inbound TCP on the proxy port so
  other machines on the LAN can reach the demo at http://<LAN-IP>:<Port>/.
  Requires an elevated (Administrator) PowerShell.
#>
[CmdletBinding()]
param(
  [int]$Port = 9090,
  [string]$RuleName = 'CSI Nora Demo (TCP 9090)'
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this in an elevated (Administrator) PowerShell."
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Firewall rule '$RuleName' already exists — nothing to do."
} else {
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
  Write-Host "Created firewall rule '$RuleName' (inbound TCP $Port)."
}
