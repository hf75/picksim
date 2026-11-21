@echo off
rem PickSim am PC starten: lokaler Webserver + Browser
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren ^(LTS^).
  pause
  exit /b 1
)
start "" http://localhost:8080
node tools\serve.mjs
pause
