# Run PowerShell AS ADMINISTRATOR, then:
#   Set-ExecutionPolicy -Scope Process Bypass -Force; .\scripts\firewall-allow-8090.ps1

$ErrorActionPreference = 'Stop'
$name = 'CSI Nora HTTP 8090'
$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Firewall rule already exists: $name"
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090
  Write-Host "Created firewall rule: $name (TCP 8090 inbound)"
}
