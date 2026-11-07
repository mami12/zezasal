@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 LTS first.
  pause
  exit /b 1
)
node "scripts\windows-server.mjs" stop
if errorlevel 1 (
  echo.
  echo Could not stop the server automatically. Use Ctrl+C in its window.
  pause
  exit /b 1
)
echo.
echo You can close this window.
pause
endlocal
