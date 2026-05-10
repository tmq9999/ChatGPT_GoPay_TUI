@echo off
chcp 65001 >nul 2>&1
title ChatGPT Auto Tool by zzamcode
cd /d "%~dp0"
color 0A

:MENU
cls
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║              ChatGPT Auto Tool                       ║
echo  ║                 github.com/zzamcode17                ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║                                                      ║
echo  ║   1. Jalankan Program                                ║
echo  ║   2. Install / Update Dependencies                   ║
echo  ║   3. Cari Path ADB (MuMu)                            ║
echo  ║   4. Cari Path MuMuManager                           ║
echo  ║   0. Keluar                                          ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
set /p CHOICE=  Pilih menu [0-4]: 

if "%CHOICE%"=="1" goto RUN_PROGRAM
if "%CHOICE%"=="2" goto INSTALL
if "%CHOICE%"=="3" goto FIND_ADB
if "%CHOICE%"=="4" goto FIND_MUMU
if "%CHOICE%"=="0" goto EXIT
echo  [!] Pilihan tidak valid, coba lagi.
timeout /t 1 >nul
goto MENU

:: ══════════════════════════════════════════════════════════
::  1. JALANKAN PROGRAM
:: ══════════════════════════════════════════════════════════
:RUN_PROGRAM
cls
echo.
echo  [INFO] Memeriksa Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan! Install dulu di https://nodejs.org/
    echo.
    pause
    goto MENU
)
if not exist "node_modules" (
    echo  [INFO] node_modules belum ada, install dependencies dulu...
    echo.
    call npm install --production
    echo.
)
echo  [RUN] Menjalankan program...
echo.
node src/index.js
if %errorlevel% neq 0 (
    echo.
    echo  [Program selesai dengan error]
)
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  2. INSTALL DEPENDENCIES
:: ══════════════════════════════════════════════════════════
:INSTALL
cls
echo.
echo  ════════════════════════════════════════
echo    Install / Update Dependencies
echo  ════════════════════════════════════════
echo.
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan!
    echo          Unduh di: https://nodejs.org/
    echo.
    pause
    goto MENU
)
echo  Node.js version:
node -v
echo.
call npm install --production
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install gagal!
    pause
    goto MENU
)
echo.
echo  ════════════════════════════════════════
echo    Instalasi selesai!
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  3. CARI PATH ADB
:: ══════════════════════════════════════════════════════════
:FIND_ADB
cls
echo.
echo  ════════════════════════════════════════
echo    FIND ADB PATH TOOL
echo  ════════════════════════════════════════
echo  Mencari adb.exe di folder MuMu...
echo.
powershell -NoProfile -Command ^
  "$envFile = Join-Path (Split-Path -Parent '%~f0') '.env';" ^
  "$found = $null;" ^
  "$knownPaths = @(" ^
  "  'C:\Program Files\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal\nx_device\12.0\shell\adb.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayer-12.0\nx_device\12.0\shell\adb.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal-12.0\nx_device\12.0\shell\adb.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayerGlobal-12.0\nx_device\12.0\shell\adb.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayerGlobal-12.0\nx_device\12.0\shell\adb.exe'," ^
  "  'E:\Program Files\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe'" ^
  ");" ^
  "foreach ($p in $knownPaths) { if (Test-Path $p) { $found = $p; break } };" ^
  "if (-not $found) {" ^
  "  Write-Host '[SCAN] Scanning semua drive...' -ForegroundColor Yellow;" ^
  "  $drives = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\\\' }).Root;" ^
  "  foreach ($drv in $drives) {" ^
  "    $scanRoots = @(" ^
  "      (Join-Path $drv 'Program Files\Netease')," ^
  "      (Join-Path $drv 'Program Files (x86)\Netease')," ^
  "      (Join-Path $drv 'Netease')" ^
  "    );" ^
  "    foreach ($root in $scanRoots) {" ^
  "      if (Test-Path $root) {" ^
  "        $r = Get-ChildItem -Path $root -Filter 'adb.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName;" ^
  "        if ($r) { $found = $r; break }" ^
  "      }" ^
  "    };" ^
  "    if ($found) { break }" ^
  "  }" ^
  "};" ^
  "if ($found) {" ^
  "  Write-Host '' ;" ^
  "  Write-Host '[FOUND] adb.exe ditemukan:' -ForegroundColor Green;" ^
  "  Write-Host $found -ForegroundColor Cyan;" ^
  "  if (Test-Path $envFile) {" ^
  "    $content = Get-Content $envFile -Raw;" ^
  "    $content = $content -replace '(?m)^(MUMU_ADB_PATH=).*$', (\"MUMU_ADB_PATH=$found\");" ^
  "    Set-Content $envFile $content -NoNewline;" ^
  "    Write-Host '' ;" ^
  "    Write-Host '[OK] .env diupdate: MUMU_ADB_PATH=' -ForegroundColor Green -NoNewline;" ^
  "    Write-Host $found -ForegroundColor Cyan" ^
  "  }" ^
  "} else {" ^
  "  Write-Host '[x] adb.exe tidak ditemukan!' -ForegroundColor Red" ^
  "}"
echo.
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  4. CARI PATH MUMU MANAGER
:: ══════════════════════════════════════════════════════════
:FIND_MUMU
cls
echo.
echo  ════════════════════════════════════════
echo    FIND MUMU MANAGER PATH TOOL
echo  ════════════════════════════════════════
echo  Mencari MuMuManager.exe...
echo.
powershell -NoProfile -Command ^
  "$found = $null;" ^
  "$knownPaths = @(" ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayer-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayer-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal\shell\MuMuManager.exe'," ^
  "  'C:\Program Files\Netease\MuMuPlayerGlobal\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayer-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayer-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayerGlobal\shell\MuMuManager.exe'," ^
  "  'C:\Program Files (x86)\Netease\MuMuPlayerGlobal\nx_main\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayer-12.0\shell\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayer-12.0\nx_main\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'D:\Program Files\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayer-12.0\shell\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayer-12.0\nx_main\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'D:\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'E:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'E:\Program Files\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'E:\Program Files\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'E:\Program Files\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayerGlobal-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayerGlobal-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayer-12.0\shell\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayer-12.0\nx_main\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayer\shell\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayer\nx_main\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayerGlobal\shell\MuMuManager.exe'," ^
  "  'C:\Netease\MuMuPlayerGlobal\nx_main\MuMuManager.exe'" ^
  ");" ^
  "foreach ($p in $knownPaths) { if (Test-Path $p) { $found = $p; break } };" ^
  "if ($found) {" ^
  "  Write-Host '[FOUND] Ditemukan di path umum:' -ForegroundColor Green;" ^
  "  Write-Host $found -ForegroundColor Cyan" ^
  "} else {" ^
  "  Write-Host '[SCAN] Tidak ada di path umum, scanning...' -ForegroundColor Yellow;" ^
  "  $drives = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\\\' }).Root;" ^
  "  $results = @();" ^
  "  foreach ($drv in $drives) {" ^
  "    $scanRoots = @(" ^
  "      (Join-Path $drv 'Program Files\Netease')," ^
  "      (Join-Path $drv 'Program Files (x86)\Netease')," ^
  "      (Join-Path $drv 'Netease')," ^
  "      (Join-Path $drv 'Games\Netease')," ^
  "      (Join-Path $drv 'Games\MuMu')," ^
  "      (Join-Path $drv 'MuMu')," ^
  "      (Join-Path $drv 'Program Files\MuMu')," ^
  "      (Join-Path $drv 'Program Files (x86)\MuMu')" ^
  "    );" ^
  "    foreach ($root in $scanRoots) {" ^
  "      if (Test-Path $root) {" ^
  "        $r = Get-ChildItem -Path $root -Filter 'MuMuManager.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName;" ^
  "        if ($r) { $results += $r }" ^
  "      }" ^
  "    }" ^
  "  };" ^
  "  if ($results.Count -gt 0) {" ^
  "    Write-Host '[FOUND] Ditemukan:' -ForegroundColor Green;" ^
  "    $results | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }" ^
  "  } else {" ^
  "    Write-Host '[FULL SCAN] Scan seluruh drive (mungkin lama)...' -ForegroundColor Yellow;" ^
  "    $allDrives = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\\\' }).Root;" ^
  "    $allFound = @();" ^
  "    foreach ($d in $allDrives) {" ^
  "      Write-Host \"  Scanning $d ...\" -ForegroundColor Gray;" ^
  "      $f = Get-ChildItem -Path $d -Filter 'MuMuManager.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName;" ^
  "      if ($f) { $allFound += $f }" ^
  "    };" ^
  "    if ($allFound.Count -gt 0) {" ^
  "      Write-Host '[FOUND] Ditemukan:' -ForegroundColor Green;" ^
  "      $allFound | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }" ^
  "    } else {" ^
  "      Write-Host '[x] MuMuManager.exe tidak ditemukan di komputer ini!' -ForegroundColor Red" ^
  "    }" ^
  "  }" ^
  "}"
echo.
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  0. KELUAR
:: ══════════════════════════════════════════════════════════
:EXIT
exit /b 0
