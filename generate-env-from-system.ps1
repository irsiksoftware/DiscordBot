# Generate .env file from system environment variables
# This solves the "I keep deleting the repo and forgetting to recreate .env" problem

Write-Host "Checking system environment variables..." -ForegroundColor Cyan
Write-Host ""

$envVars = @{
    "DISCORD_TOKEN" = $env:DISCORD_TOKEN
    "DISCORD_APPLICATION_ID" = $env:DISCORD_APPLICATION_ID
    "OPENAI_API_KEY" = $env:OPENAI_API_KEY
    "GITHUB_TOKEN" = $env:GITHUB_TOKEN
    "GITHUB_OWNER" = $env:GITHUB_OWNER
    "ENABLE_WEBHOOKS" = $env:ENABLE_WEBHOOKS
    "WEBHOOK_PORT" = $env:WEBHOOK_PORT
    "WEBHOOK_SECRET" = $env:WEBHOOK_SECRET
}

$foundVars = @{}
$missingVars = @()

foreach ($key in $envVars.Keys) {
    if ($envVars[$key]) {
        $foundVars[$key] = $envVars[$key]
        if ($key -match "TOKEN|KEY|SECRET") {
            Write-Host "[OK] $key is set (value hidden)" -ForegroundColor Green
        } else {
            Write-Host "[OK] $key = $($envVars[$key])" -ForegroundColor Green
        }
    } else {
        $missingVars += $key
        if ($key -eq "DISCORD_TOKEN" -or $key -eq "DISCORD_APPLICATION_ID") {
            Write-Host "[REQUIRED] $key is NOT set" -ForegroundColor Red
        } else {
            Write-Host "[OPTIONAL] $key is NOT set" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# Check if we have the required variables
if (-not $foundVars["DISCORD_TOKEN"] -or -not $foundVars["DISCORD_APPLICATION_ID"]) {
    Write-Host "ERROR: Missing required environment variables!" -ForegroundColor Red
    Write-Host "Please set the following system environment variables:" -ForegroundColor Yellow
    Write-Host "  - DISCORD_TOKEN" -ForegroundColor White
    Write-Host "  - DISCORD_APPLICATION_ID" -ForegroundColor White
    Write-Host ""
    Write-Host "Then re-run this script to generate the .env file." -ForegroundColor Yellow
    exit 1
}

# Generate .env file
Write-Host "Generating .env file..." -ForegroundColor Cyan

$envContent = @"
# Auto-generated from system environment variables
# Generated on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

"@

foreach ($key in $foundVars.Keys) {
    $envContent += "$key=$($foundVars[$key])`n"
}

# Write to .env file
$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "✅ .env file created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now start the bot with: npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pro tip: Add this to your startup script so .env is always regenerated:" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File generate-env-from-system.ps1" -ForegroundColor White
