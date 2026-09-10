@echo off
setlocal
title Lorekeeper

rem Lorekeeper launcher - single-process production server on http://127.0.0.1:3000

cd /d "%~dp0"

rem --- 1. Bun must be on PATH ---
where bun >nul 2>nul
if errorlevel 1 (
  echo [Lorekeeper] ERROR: "bun" was not found in PATH.
  echo.
  echo Install Bun first:  https://bun.sh  ^|  powershell -c "irm bun.sh/install.ps1 | iex"
  echo Then reopen this terminal and run start.bat again.
  echo.
  pause
  exit /b 1
)

rem --- 2. Frontend production build must exist; build it if missing ---
if not exist "apps\frontend\dist\index.html" (
  echo [Lorekeeper] No frontend build found - building production bundle...
  bun run build
  if errorlevel 1 (
    echo.
    echo [Lorekeeper] ERROR: frontend build failed. Fix the errors above and retry.
    pause
    exit /b 1
  )
)

echo [Lorekeeper] Starting server on http://127.0.0.1:3000 ...
echo [Lorekeeper] Press Ctrl+C in this window to stop.
echo.

rem --- 3. Open the default browser (server boots in under a second) ---
start "" "http://127.0.0.1:3000"

rem --- 4. Run the server in the foreground; trap any crash so the window stays open ---
bun run start
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
  echo [Lorekeeper] ERROR: server exited with code %EXITCODE%.
  echo Common causes: port 3000 already in use, or a failed startup migration.
  echo Check the messages above for details.
) else (
  echo [Lorekeeper] Server stopped.
)
pause
exit /b %EXITCODE%
