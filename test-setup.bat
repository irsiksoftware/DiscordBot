@echo off
echo ============================================
echo Discord Bot Setup Checker
echo ============================================
echo.

REM Check Node.js
echo [1/5] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] Node.js not found! Please install Node.js 18 or higher.
    echo   Download from: https://nodejs.org/
) else (
    node --version
    echo   [OK] Node.js found
)
echo.

REM Check npm
echo [2/5] Checking npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] npm not found!
) else (
    npm --version
    echo   [OK] npm found
)
echo.

REM Check .env file
echo [3/5] Checking .env file...
if exist ".env" (
    echo   [OK] .env file exists
    echo.
    echo   Checking required variables:
    findstr /C:"DISCORD_TOKEN=" .env >nul 2>&1
    if %errorlevel% equ 0 (
        echo   [OK] DISCORD_TOKEN found
    ) else (
        echo   [WARN] DISCORD_TOKEN not found or empty
    )
    findstr /C:"DISCORD_APPLICATION_ID=" .env >nul 2>&1
    if %errorlevel% equ 0 (
        echo   [OK] DISCORD_APPLICATION_ID found
    ) else (
        echo   [WARN] DISCORD_APPLICATION_ID not found or empty
    )
) else (
    echo   [FAIL] .env file not found!
    echo   Please copy .env.example to .env and fill in your credentials.
)
echo.

REM Check node_modules
echo [4/5] Checking dependencies...
if exist "node_modules" (
    echo   [OK] node_modules folder exists
) else (
    echo   [WARN] node_modules not found. Run: npm install
)
echo.

REM Check main entry point
echo [5/5] Checking bot files...
if exist "src\index.js" (
    echo   [OK] src\index.js exists
) else (
    echo   [FAIL] src\index.js not found!
)
echo.

echo ============================================
echo Setup check complete!
echo ============================================
echo.
echo Next steps:
echo 1. Fix any [FAIL] or [WARN] items above
echo 2. Run: npm install (if needed)
echo 3. Test the bot: npm start
echo 4. Create scheduled task: Run create-scheduled-task.ps1 as Administrator
echo.
pause
