$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Creating Python 3.11 venv"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example — add API keys as needed."
}

Write-Host "==> Starting Docker Compose stack"
docker compose up -d

Write-Host "==> Pulling Ollama models"
bash scripts/pull_ollama_models.sh

Write-Host ""
Write-Host "Ready!"
Write-Host "  Jupyter:   http://localhost:8888  (token: sandbox)"
Write-Host "  Streamlit: docker compose --profile dashboard up -d  then http://localhost:8501"
Write-Host "  Or local:  streamlit run dashboard/app.py"
