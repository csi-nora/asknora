param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("cpu", "gpu", "npu", "auto")]
    [string]$Device
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$overlay = switch ($Device) {
    "gpu" { "docker-compose.gpu.yml" }
    "npu" { "docker-compose.npu.yml" }
    "auto" { "docker-compose.cpu.yml" }  # safe default until GPU detected
    default { "docker-compose.cpu.yml" }
}

$numGpu = if ($Device -eq "gpu") { "-1" } else { "0" }
$ovDevice = if ($Device -eq "npu") { "NPU" } elseif ($Device -eq "gpu") { "GPU" } else { "CPU" }

Write-Host "==> Setting ACCEL_DEVICE=$Device (overlay: $overlay)"

$envPath = Join-Path $Root ".env"
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $Root ".env.example") $envPath
}

$lines = Get-Content $envPath
$keys = @{
    "ACCEL_DEVICE"     = $Device
    "OLLAMA_NUM_GPU"   = $numGpu
    "OPENVINO_DEVICE"  = $ovDevice
}
foreach ($k in $keys.Keys) {
    $found = $false
    $lines = $lines | ForEach-Object {
        if ($_ -match "^$k=") {
            $found = $true
            "$k=$($keys[$k])"
        } else { $_ }
    }
    if (-not $found) { $lines += "$k=$($keys[$k])" }
}
$lines | Set-Content $envPath

Write-Host "==> Recreating Ollama with $Device overlay"
docker compose -f docker-compose.yml -f $overlay up -d ollama

Write-Host ""
Write-Host "Done. Preference: $Device"
Write-Host "  Probe:  python -c `"from src.providers.device import status_report; import json; print(json.dumps(status_report('$Device'), indent=2))`""
Write-Host "  UI:     streamlit run dashboard/app_lite.py"
