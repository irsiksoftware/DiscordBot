@echo off
REM Discord Bot Startup Script for Windows Task Scheduler

REM Change to bot directory
cd /d "%~dp0"

REM Log startup attempt
echo [%date% %time%] Starting Discord bot... >> bot-startup.log

REM Auto-generate .env from system environment variables
echo [%date% %time%] Regenerating .env from system environment variables... >> bot-startup.log
powershell -ExecutionPolicy Bypass -File "generate-env-from-system.ps1" >> bot-startup.log 2>&1

if not exist ".env" (
    echo [%date% %time%] ERROR: Failed to generate .env file! >> bot-startup.log
    echo ERROR: Failed to generate .env file!
    echo Please ensure DISCORD_TOKEN and DISCORD_APPLICATION_ID are set as system environment variables.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo [%date% %time%] Installing dependencies... >> bot-startup.log
    call npm install
)

REM Start the bot with npm
echo [%date% %time%] Launching bot... >> bot-startup.log
call npm start 2>&1 | tee -a bot-startup.log

REM If bot exits, log it
echo [%date% %time%] Bot stopped. >> bot-startup.log
pause
