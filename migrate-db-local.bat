@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
echo Moving the existing database to this PC. Keep every other server stopped.
node "scripts\local-db-setup.mjs" migrate
if errorlevel 1 (
  echo Migration did not finish. Keep the existing database configuration.
  pause
  exit /b 1
)
echo Run start.bat to open the website with its local database.
pause
endlocal
