@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title StreamVerse Lite - Proxy and Source Diagnostics
where node.exe >nul 2>&1
if errorlevel 1 (echo [ERROR] Node.js is missing & goto :end)
echo Checking v2rayN HTTP/Mixed proxy and available adult sources...
echo.
set "PREFERRED_PORT=10808"
set /p "PREFERRED_PORT=Preferred HTTP/Mixed proxy port [10808]: "
if not defined PREFERRED_PORT set "PREFERRED_PORT=10808"
set "SELECTED_PORT="
for /f "tokens=1,2 delims==" %%A in ('node "%~dp0proxy-check.mjs" --choose "%PREFERRED_PORT%"') do (
  if /i "%%A"=="PORT" set "SELECTED_PORT=%%B"
)
if not defined SELECTED_PORT (
  echo [WARNING] No validated HTTP proxy; testing direct network, results may time out.
) else (
  set "HTTP_PROXY=http://127.0.0.1:%SELECTED_PORT%"
  set "HTTPS_PROXY=http://127.0.0.1:%SELECTED_PORT%"
  set "http_proxy=http://127.0.0.1:%SELECTED_PORT%"
  set "https_proxy=http://127.0.0.1:%SELECTED_PORT%"
  set "NO_PROXY=localhost,127.0.0.1,::1"
  set "no_proxy=localhost,127.0.0.1,::1"
  set "NODE_USE_ENV_PROXY=1"
  set "SV_PROXY_PORT=%SELECTED_PORT%"
)
echo.
node "%~dp0diagnose-sources.mjs"
:end
echo.
pause
endlocal
