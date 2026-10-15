@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title StreamVerse Lite - Proxy Launcher

echo ======================================================
echo         StreamVerse Lite - v2rayN Proxy Launcher
echo ======================================================
echo Important: the port must support HTTP or Mixed mode.
echo 10808 may be SOCKS only in some v2rayN versions.
echo This launcher will TEST HTTP CONNECT and try 10809 if needed.
echo.
where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    goto :failed
)
set "PREFERRED_PORT=10808"
set /p "PREFERRED_PORT=Preferred proxy port [10808]: "
if not defined PREFERRED_PORT set "PREFERRED_PORT=10808"
set "SELECTED_PORT="
for /f "tokens=1,2 delims==" %%A in ('node "%~dp0proxy-check.mjs" --choose "%PREFERRED_PORT%"') do (
  if /i "%%A"=="PORT" set "SELECTED_PORT=%%B"
)
if not defined SELECTED_PORT (
    echo.
    echo [ERROR] HTTP proxy verification failed. Site was NOT started through an unverified proxy.
    echo Inspect your v2rayN HTTP / Mixed port in Parameter Settings.
    goto :failed
)
set "HTTP_PROXY=http://127.0.0.1:%SELECTED_PORT%"
set "HTTPS_PROXY=http://127.0.0.1:%SELECTED_PORT%"
set "http_proxy=http://127.0.0.1:%SELECTED_PORT%"
set "https_proxy=http://127.0.0.1:%SELECTED_PORT%"
set "NO_PROXY=localhost,127.0.0.1,::1"
set "no_proxy=localhost,127.0.0.1,::1"
set "NODE_USE_ENV_PROXY=1"
set "SV_PROXY_PORT=%SELECTED_PORT%"
echo.
echo Proxy selected: HTTP 127.0.0.1:%SELECTED_PORT%
echo Proxy support: NODE_USE_ENV_PROXY=1
echo IMPORTANT: Close any older StreamVerse Lite server before proceeding.
echo.
call "%~dp0start-windows.bat"
exit /b %ERRORLEVEL%
:failed
echo.
echo This window will remain open so you can read the error.
pause
exit /b 1
