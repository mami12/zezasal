@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if "%~1"=="" (
  node "scripts\local-db-setup.mjs" restore "database-transfer.tgz"
) else (
  node "scripts\local-db-setup.mjs" restore "%~1"
)
if errorlevel 1 (
  echo Restore did not finish. The existing database was preserved.
  echo Check LOCAL-DATABASE.md and the selected backup, then try again.
  pause
  exit /b 1
)
pause
endlocal
