@echo off
:: ===== PBS-Manager.bat =====
:: Simple manager for PBS Bot (modular) + Cloudflare Tunnel

setlocal enableextensions enabledelayedexpansion

:: ==== CONFIG - EDIT THIS SECTION IF NEEDED ====
set "BOT_DIR=D:\Bot\pbs-bot-modular"
set "NODE_BIN=node"
set "NPM_BIN=npm"
set "CLOUDFLARE_BIN=cloudflared"
set "CLOUDFLARE_CONFIG=D:\Bot\BOTWA\cloudflare\.cloudflared\config.yml"

:: Unique window titles so we can stop them safely
set "BOT_WIN= PBS-BOT (modular) "
set "TUN_WIN= PBS-TUNNEL "

:: ==== Read .env for PORT and ADMIN_WEBHOOK_SECRET (optional) ====
set "PORT=3000"
set "ADMIN_SECRET="
if exist "%BOT_DIR%\.env" (
  for /f "usebackq tokens=1,* delims== eol=#" %%A in ("%BOT_DIR%\.env") do (
    if /I "%%A"=="PORT" set "PORT=%%B"
    if /I "%%A"=="ADMIN_WEBHOOK_SECRET" set "ADMIN_SECRET=%%B"
  )
)

:: Trim quotes/spaces
for /f "tokens=* delims= " %%A in ("%PORT%") do set "PORT=%%~A"
for /f "tokens=* delims= " %%A in ("%ADMIN_SECRET%") do set "ADMIN_SECRET=%%~A"

:: ==== FUNCTIONS ====
:menu
cls
echo ==================================================
echo           PBS Manager - Putra Btt Store
echo ==================================================
echo  [1] Start Bot
echo  [2] Stop Bot
echo  [3] Start Tunnel
echo  [4] Stop Tunnel
echo  [5] Start BOTH (Bot + Tunnel)
echo  [6] Stop  BOTH
echo  [7] Check Status
echo  [8] Admin Reload (Sheets / Promo)
echo  [9] Show .env summary
echo  [0] Exit
echo --------------------------------------------------
echo  Bot Dir   : %BOT_DIR%
echo  Port      : %PORT%
echo  Tunnel cfg: %CLOUDFLARE_CONFIG%
echo ==================================================
set /p "choice=Select: "
if "%choice%"=="1" goto start_bot
if "%choice%"=="2" goto stop_bot
if "%choice%"=="3" goto start_tunnel
if "%choice%"=="4" goto stop_tunnel
if "%choice%"=="5" goto start_both
if "%choice%"=="6" goto stop_both
if "%choice%"=="7" goto status
if "%choice%"=="8" goto admin_reload
if "%choice%"=="9" goto show_env
if "%choice%"=="0" goto end
goto menu

:start_bot
echo.
echo [Start Bot] %BOT_DIR%
pushd "%BOT_DIR%"
start "%BOT_WIN%" cmd /k "%NPM_BIN% run start"
popd
echo Done. A new window with title [%BOT_WIN%] should appear.
if /I "%~1"=="nopause" goto :eof
pause
goto menu

:stop_bot
echo.
echo [Stop Bot]
:: safer kill only node.exe that runs this project
for /f "tokens=2 delims==; " %%P in ('wmic process where "name='node.exe' and CommandLine like '%%pbs-bot-modular%%src%%index.js%%'" get ProcessId /value ^| find "="') do (
  echo Killing node PID %%P
  taskkill /PID %%P /F >nul 2>&1
)
:: also try kill by window title
taskkill /FI "WINDOWTITLE eq%BOT_WIN%*" /T /F >nul 2>&1
echo Done.
pause
goto menu

:start_tunnel
echo.
echo [Start Tunnel] using %CLOUDFLARE_CONFIG%
start "%TUN_WIN%" "%CLOUDFLARE_BIN%" --config "%CLOUDFLARE_CONFIG%" tunnel run
echo Done. A new window with title [%TUN_WIN%] should appear.
if /I "%~1"=="nopause" goto :eof
pause
goto menu

:stop_tunnel
echo.
echo [Stop Tunnel]
taskkill /IM cloudflared.exe /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq%TUN_WIN%*" /T /F >nul 2>&1
echo Done.
pause
goto menu

:start_both
call :start_bot nopause
call :start_tunnel nopause
echo.
echo BOTH started.
pause
goto menu

:stop_both
call :stop_bot
call :stop_tunnel
goto menu

:status
echo.
echo [Status]
:: Check port
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:%PORT%/status -TimeoutSec 3; if($r.StatusCode -eq 200){Write-Host 'HTTP : OK' -f Green; $r.Content}else{Write-Host ('HTTP : ' + $r.StatusCode) -f Yellow}}catch{Write-Host 'HTTP : DOWN' -f Red}"
:: List processes
echo.
echo Node processes for pbs-bot-modular:
wmic process where "name='node.exe' and CommandLine like '%%pbs-bot-modular%%'" get ProcessId,CommandLine /format:list
echo.
echo Cloudflared processes:
wmic process where "name='cloudflared.exe'" get ProcessId,CommandLine /format:list
echo.
pause
goto menu

:admin_reload
echo.
if "%ADMIN_SECRET%"=="" (
  echo ADMIN_WEBHOOK_SECRET not found in .env. Aborting.
  pause
  goto menu
)
set /p "what=Reload what? [all/produk/promo] : "
if "%what%"=="" set "what=all"
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Uri http://localhost:%PORT%/admin/reload -Method POST -ContentType 'application/json' -Body ('{\"secret\":\"%ADMIN_SECRET%\",\"what\":\"%what%\",\"note\":\"reload from manager\"}') | Select-Object -Expand Content | Write-Host -f Green}catch{Write-Host $_ -f Red}"
pause
goto menu

:show_env
echo.
echo PORT=%PORT%
echo ADMIN_WEBHOOK_SECRET=%ADMIN_SECRET%
echo PUBLIC_BASE_URL=(see .env)
echo GAS_WEBHOOK_URL=(see .env)
echo MIDTRANS_IS_PRODUCTION=(see .env)
echo.
pause
goto menu

:end
echo Bye.
endlocal
exit /b 0
