@echo off
setlocal EnableExtensions
chcp 65001 >nul
title StreamVerse Lite - Local Server
cd /d "%~dp0"

echo ======================================================
echo              StreamVerse Lite Launcher
echo ======================================================
echo Project folder: %CD%
echo.

if not exist "server.js" (
    echo [ERROR] server.js was not found in this folder.
    echo Please extract the complete ZIP file before starting.
    goto :finish
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Install Node.js 20 or 22 from https://nodejs.org/
    echo Then close all terminals and launch this file again.
    goto :finish
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 (
    echo [ERROR] The Node.js version is too old. Node.js 20 or 22 is recommended.
    node --version
    goto :finish
)

echo Node version:
node --version
echo.
echo Starting StreamVerse Lite (not VisionCraft)...
echo The browser will open after the web server is ready.
echo Default port 37925; if busy, ports 37926-37935 will be tried.
echo Keep this window open while using the site.
echo To stop the server, press Ctrl+C, then choose N if asked.
echo.

if exist "tmdb-key.txt" (
    set /p TMDB_API_KEY=<"tmdb-key.txt"
    if defined TMDB_API_KEY (echo TMDB key loaded: movie and TV trending feeds enabled.)
)
set "AUTO_OPEN_BROWSER=1"
node "server.js"
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
echo ======================================================
echo [INFO] Server stopped. Exit code: %SERVER_EXIT%
echo If there was an error, the message is shown above.
echo ======================================================

:finish
echo.
echo This window will remain open until you press a key.
pause >nul
endlocal
