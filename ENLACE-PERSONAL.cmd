@echo off
chcp 65001 >nul
title Enlace para el personal - Hospital Schestakow
cd /d "%~dp0"
set "CF=%~dp0tools\cloudflared.exe"
where cloudflared >nul 2>nul && set "CF=cloudflared"
if /i not "%CF%"=="cloudflared" if not exist "%CF%" (
  echo.
  echo   Falta el programa de tunel de Cloudflare ^(cloudflared^).
  echo   Se va a descargar del sitio oficial:
  echo   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  echo.
  echo   Si estas de acuerdo, toca una tecla. Si no, cerra esta ventana.
  pause >nul
  curl.exe -L --fail -o "%CF%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if errorlevel 1 ( echo   No se pudo descargar. & pause & exit /b 1 )
)
echo.
echo   Abriendo el enlace... ^(tarda unos segundos^)
node scripts\enlace-personal.mjs "%CF%"
pause
