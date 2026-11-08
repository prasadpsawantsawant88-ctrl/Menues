@echo off
setlocal
cd /d "%~dp0"
title DineFlow - install and start
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. DineFlow needs Node.js 20 or newer.
  echo Opening the download page. Install the LTS version, then double-click this file again.
  start https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
echo Installing DineFlow. The first run needs internet and takes 1-3 minutes.
call npm install --no-audit --no-fund
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
node scripts\launch.mjs
if errorlevel 1 (
  echo.
  echo Something went wrong. Read the message above, or see README.md - Troubleshooting.
  pause
  exit /b 1
)
echo.
echo You can close this window. DineFlow keeps running in the background.
pause
endlocal
