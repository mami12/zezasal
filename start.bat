@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS with npm from https://nodejs.org/en/download
  echo Then close this window and double-click start.bat again.
  pause
  exit /b 1
)
node "scripts\windows-server.mjs" start
if errorlevel 1 (
  echo.
  echo Server did not start. Read the message above.
  pause
  exit /b 1
)
endlocal
