@echo off
rem PickSim fuer die Meta Quest 3 im gleichen WLAN bereitstellen (HTTPS, selbstsigniertes Zertifikat)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren ^(LTS^).
  pause
  exit /b 1
)
echo.
echo  Die Adresse fuer die Quest erscheint gleich unten (https://...:8443).
echo  In der Quest den Browser oeffnen, Adresse eintippen, Warnung "Erweitert - Weiter" bestaetigen.
echo  Falls die Quest den PC nicht erreicht: Windows-Firewall fuer Node.js im privaten Netzwerk erlauben.
echo.
node tools\serve.mjs --https
pause
