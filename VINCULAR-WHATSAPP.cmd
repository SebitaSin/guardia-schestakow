@echo off
setlocal
cd /d "%~dp0"
title Vincular WhatsApp del hospital con la app
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 for /d %%D in ("%~dp0..\..\tools\node-v*-win-x64") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
"%NODE%" server\wa-link\listener.mjs --link
echo.
pause
