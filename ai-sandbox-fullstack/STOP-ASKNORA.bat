@echo off
REM ============================================================================
REM  STOP-ASKNORA.bat  -  Stop the CSI Nora full stack (Windows)
REM ============================================================================
setlocal
title CSI Nora - Stop
set "BASE=%~dp0"

set "SANDBOX="
if exist "%BASE%ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%ai-ecosystem-sandbox"
if not defined SANDBOX if exist "%BASE%csi-nora-fullstack\ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%csi-nora-fullstack\ai-ecosystem-sandbox"
if not defined SANDBOX if exist "%BASE%ai-sandbox-fullstack\ai-ecosystem-sandbox\docker-compose.yml" set "SANDBOX=%BASE%ai-sandbox-fullstack\ai-ecosystem-sandbox"

if not defined SANDBOX (
  echo [ERROR] Could not find "ai-ecosystem-sandbox" near this file.
  pause
  exit /b 1
)

pushd "%SANDBOX%"
echo ==^> Stopping the CSI Nora stack...
docker compose -f docker-compose.yml -f docker-compose.proxy.yml down
popd
echo Done.
pause
endlocal
