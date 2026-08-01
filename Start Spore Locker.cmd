@echo off
setlocal
cd /d "%~dp0"
node scripts\configure-local-env.mjs
if errorlevel 1 (
  echo Spore Locker could not create its local configuration.
  pause
  exit /b 1
)
docker compose --env-file .env.compose -p spore-locker-isolated up -d --build
if errorlevel 1 (
  echo.
  echo Spore Locker could not start. Open Docker Desktop, wait until it is ready, then run this launcher again.
  pause
  exit /b 1
)
start "" "http://localhost:3000"
echo Spore Locker is starting. Its local preview will open in your browser.
timeout /t 3 /nobreak >nul
