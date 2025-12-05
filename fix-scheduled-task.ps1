# Fix the scheduled task to run start-bot.bat instead of node directly

$TaskName = "IrsikSoftware Discord Bot"
$BotDirectory = "C:\Code\DiscordBot"
$StartScript = "$BotDirectory\start-bot.bat"

Write-Host "Removing existing task..." -ForegroundColor Yellow
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Creating new task with correct action..." -ForegroundColor Cyan

# Create action - run the batch file
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartScript`"" -WorkingDirectory $BotDirectory

# Create trigger - At system startup
$trigger = New-ScheduledTaskTrigger -AtStartup

# Create settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Create principal (run with highest privileges)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

# Register the task
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Automatically starts the NeonLadder Discord Bot"

Write-Host "Task fixed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Task now runs: $StartScript" -ForegroundColor Cyan
