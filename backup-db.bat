@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
node "scripts\local-db-setup.mjs" backup
if errorlevel 1 (
  echo Backup did not finish. Check LOCAL-DATABASE.md.
  pause
  exit /b 1
)
pause
endlocal
