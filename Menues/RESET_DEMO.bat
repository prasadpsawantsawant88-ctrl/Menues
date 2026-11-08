@echo off
setlocal
cd /d "%~dp0"
title DineFlow - reset demo data
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
node scripts\reset.mjs
if errorlevel 1 (
  echo.
  echo Something went wrong. Read the message above, or see README.md - Troubleshooting.
  pause
  exit /b 1
)
pause
endlocal
