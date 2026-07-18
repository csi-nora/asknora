@echo off
REM ============================================================================
REM  RUN-ASKNORA.bat  -  One-click launcher for the CSI Nora full stack (Windows)
REM
REM  Double-click this file (or run it from a terminal). It finds the sandbox
REM  folder next to itself, builds the Angular UI, starts the whole Docker stack
REM  (UI + nginx proxy + Ollama + bridge + vector DBs) on port 9090, pulls the
REM  demo model on first run, and opens the app in your browser.
REM
REM  Works whether this file sits in the deployable root, the USB root, or the
REM  workspace root - it auto-locates ai-ecosystem-sandbox.
REM ============================================================================
setlocal enabledelayedexpansion
title CSI Nora - Launcher
set "PORT=9090"
set "MODEL=llama3.2:3b"
set "BASE=%~dp0"

REM --- Locate the sandbox directory relative to this file ----------------------
set "SANDBOX="
if exist "%BASE%ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%ai-ecosystem-sandbox"
if not defined SANDBOX if exist "%BASE%csi-nora-fullstack\ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%csi-nora-fullstack\ai-ecosystem-sandbox"
if not defined SANDBOX if exist "%BASE%ai-sandbox-fullstack\ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%ai-sandbox-fullstack\ai-ecosystem-sandbox"

if not defined SANDBOX (
  echo [ERROR] Could not find "ai-ecosystem-sandbox" near this file.
  echo         Place RUN-ASKNORA.bat in the deployable root, the USB root,
  echo         or inside the csi-nora-fullstack folder.
  echo.
  pause
  exit /b 1
)
echo ==^> Sandbox: %SANDBOX%

REM --- Check Docker is running -------------------------------------------------
docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not running. Start it and re-run this file.
  echo.
  pause
  exit /b 1
)

REM --- Build UI + start the full stack via the tested PowerShell launcher ------
echo ==^> Building UI and starting the full stack on port %PORT% ^(first run takes a few minutes^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SANDBOX%\scripts\start_proxy.ps1" -Port %PORT%
if errorlevel 1 (
  echo [ERROR] Startup failed. See the messages above.
  echo.
  pause
  exit /b 1
)

REM --- Pull the demo model on first run ---------------------------------------
echo ==^> Ensuring Ollama model "%MODEL%" is present ^(first run downloads ~2 GB^)...
docker exec sandbox-ollama ollama pull %MODEL%
if errorlevel 1 echo [WARN] Model pull failed; you can run it later: docker exec sandbox-ollama ollama pull %MODEL%

REM --- Open the app -----------------------------------------------------------
timeout /t 3 >nul
start "" "http://localhost:%PORT%/"

echo.
echo ======================================================================
echo  CSI Nora is UP
echo    Local : http://localhost:%PORT%/
echo    LAN   : http://^<your-LAN-IP^>:%PORT%/   ^(run 'ipconfig' to find it^)
echo    Health: http://localhost:%PORT%/healthz
echo ----------------------------------------------------------------------
echo  To stop the stack, run STOP-ASKNORA.bat (or 'docker compose ... down').
echo ======================================================================
echo.
pause
endlocal
