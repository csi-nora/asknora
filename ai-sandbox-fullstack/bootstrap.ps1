# One-shot bootstrap (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Starting Docker sandbox..."
Set-Location ai-ecosystem-sandbox
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d
docker exec sandbox-ollama ollama pull llama3.2:1b

Write-Host "==> Python venv + bridge deps..."
if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\pip.exe install -q -r requirements-smoke.txt fastapi uvicorn streamlit
Start-Process -FilePath ".\.venv\Scripts\uvicorn.exe" -ArgumentList "apps.nora_bridge.main:app","--host","0.0.0.0","--port","8090" -WindowStyle Minimized
Start-Process -FilePath ".\.venv\Scripts\streamlit.exe" -ArgumentList "run","dashboard\app_lite.py","--server.port","8501","--server.headless","true" -WindowStyle Minimized

Write-Host "==> CSI Nora..."
Set-Location ..\csi-nora-v2
if (-not (Test-Path node_modules)) { npm install }
Write-Host "Starting Nora at http://localhost:4200"
npm start
