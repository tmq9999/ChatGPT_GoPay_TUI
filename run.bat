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
echo  ║   1. Run Program                                 ║
echo  ║   2. Install / Update Dependencies               ║
echo  ║   3. Find ADB Path (MuMu)                        ║
echo  ║   4. Find MuMuManager Path                       ║
echo  ║   0. Exit                                        ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
set /p CHOICE=  Choose menu [0-4]: 

if "%CHOICE%"=="1" goto RUN_PROGRAM
if "%CHOICE%"=="2" goto INSTALL
if "%CHOICE%"=="3" goto FIND_ADB
if "%CHOICE%"=="4" goto FIND_MUMU
if "%CHOICE%"=="0" goto EXIT
echo  [!] Invalid choice, try again.
timeout /t 1 >nul
goto MENU

:: ══════════════════════════════════════════════════════════
::  1. RUN PROGRAM
:: ══════════════════════════════════════════════════════════
:RUN_PROGRAM
cls
echo.
echo  [INFO] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found! Install it at https://nodejs.org/
    echo.
    pause
    goto MENU
)
if not exist "node_modules" (
    echo  [INFO] node_modules not found, installing dependencies first...
    echo.
    call npm install --production
    echo.
)
echo  [RUN] Running program...
echo.
node src/index.js
if %errorlevel% neq 0 (
    echo.
    echo  [Program exited with error]
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
    echo  [ERROR] Node.js not found!
    echo          Download from: https://nodejs.org/
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
    echo  [ERROR] npm install failed!
    pause
    goto MENU
)
echo.
echo  ════════════════════════════════════════
echo    Installation complete!
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  3. FIND ADB PATH
:: ══════════════════════════════════════════════════════════
:FIND_ADB
cls
echo.
echo  ════════════════════════════════════════
echo    FIND ADB PATH TOOL
echo  ════════════════════════════════════════
echo  Searching for adb.exe in MuMu folder...
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
  "  Write-Host '[SCAN] Scanning all drives...' -ForegroundColor Yellow;" ^
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
  "  Write-Host '[FOUND] adb.exe found:' -ForegroundColor Green;" ^
  "  Write-Host $found -ForegroundColor Cyan;" ^
  "  if (Test-Path $envFile) {" ^
  "    $content = Get-Content $envFile -Raw;" ^
  "    $content = $content -replace '(?m)^(MUMU_ADB_PATH=).*$', (\"MUMU_ADB_PATH=$found\");" ^
  "    Set-Content $envFile $content -NoNewline;" ^
  "    Write-Host '' ;" ^
    "    Write-Host '[OK] .env updated: MUMU_ADB_PATH=' -ForegroundColor Green -NoNewline;" ^
  "    Write-Host $found -ForegroundColor Cyan" ^
  "  }" ^
  "} else {" ^
  "  Write-Host '[x] adb.exe not found!' -ForegroundColor Red" ^
  "}"
echo.
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  4. FIND MUMU MANAGER PATH
:: ══════════════════════════════════════════════════════════
:FIND_MUMU
cls
echo.
echo  ════════════════════════════════════════
echo    FIND MUMU MANAGER PATH TOOL
echo  ════════════════════════════════════════
echo  Searching for MuMuManager.exe...
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
  "  Write-Host '[FOUND] Found at common path:' -ForegroundColor Green;" ^
  "  Write-Host $found -ForegroundColor Cyan" ^
  "} else {" ^
  "  Write-Host '[SCAN] Not found at common path, scanning...' -ForegroundColor Yellow;" ^
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
    "    Write-Host '[FOUND] Found:' -ForegroundColor Green;" ^
  "    $results | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }" ^
  "  } else {" ^
    "      Write-Host '[FULL SCAN] Scanning entire drive (may take a while)...' -ForegroundColor Yellow;" ^
  "    $allDrives = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\\\' }).Root;" ^
  "    $allFound = @();" ^
  "    foreach ($d in $allDrives) {" ^
  "      Write-Host \"  Scanning $d ...\" -ForegroundColor Gray;" ^
  "      $f = Get-ChildItem -Path $d -Filter 'MuMuManager.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName;" ^
  "      if ($f) { $allFound += $f }" ^
  "    };" ^
  "    if ($allFound.Count -gt 0) {" ^
  "      Write-Host '[FOUND] Found:' -ForegroundColor Green;" ^
  "      $allFound | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }" ^
  "    } else {" ^
      "  Write-Host '[x] MuMuManager.exe not found on this computer!' -ForegroundColor Red" ^
  "    }" ^
  "  }" ^
  "}"
echo.
echo  ════════════════════════════════════════
echo.
pause
goto MENU

:: ══════════════════════════════════════════════════════════
::  0. EXIT
:: ══════════════════════════════════════════════════════════
:EXIT
exit /b 0
