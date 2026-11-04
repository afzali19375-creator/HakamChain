@echo off
chcp 65001 >nul
title HakamChain - Local Runner
cd /d "%~dp0"

echo ==================================================
echo   HakamChain - One-Click Local Runner
echo   This window runs the WEBSITE - keep it open!
echo ==================================================
echo.

echo [1/4] Stopping leftovers from previous runs...
taskkill /F /IM node.exe >nul 2>&1

if not exist node_modules (
  echo [2/4] Installing dependencies - takes 2-5 minutes, please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
) else (
  echo [2/4] Dependencies already installed - skipping.
)

echo [3/4] Starting local blockchain in a NEW window (do not close it)...
start "HakamChain Blockchain - DO NOT CLOSE" cmd /k "chcp 65001 >nul && npx hardhat node"
timeout /t 8 /nobreak >nul

echo [4/4] Deploying contract and syncing .env...
call npx hardhat run scripts/deploy.js --network localhost
if errorlevel 1 (
  echo.
  echo [ERROR] Deploy failed. Make sure the blockchain window is open.
  echo         Close this window and run start-windows.bat again.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo   DONE!  Open your browser at:  http://localhost:3000
echo   Keep BOTH windows open. Stop = close both windows.
echo ==================================================
call npm start
pause
