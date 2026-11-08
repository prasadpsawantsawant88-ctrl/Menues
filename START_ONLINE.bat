@echo off
setlocal
cd /d "%~dp0"
title DineFlow - online (public link)
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
echo Keep this window open while presenting. Press Ctrl+C to go offline.
node scripts\online.mjs
if errorlevel 1 (
  echo.
  echo Something went wrong. Read the message above, or see README.md - Troubleshooting.
  pause
  exit /b 1
)
echo.
echo DineFlow is offline again.
pause
endlocal
