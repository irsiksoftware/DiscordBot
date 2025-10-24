# PowerShell script to create Windows Scheduled Task for Discord Bot
# Run as Administrator

$TaskName = "IrsikSoftware Discord Bot"
$BotDirectory = "C:\Code\DiscordBot"
$StartScript = "$BotDirectory\start-bot.bat"

Write-Host "Creating scheduled task: $TaskName" -ForegroundColor Cyan

# Check if task already exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Task already exists. Removing old task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create action - run the batch file
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartScript`"" -WorkingDirectory $BotDirectory

# Create trigger - At system startup (change as needed)
# Options:
# 1. At startup: $trigger = New-ScheduledTaskTrigger -AtStartup
# 2. At logon: $trigger = New-ScheduledTaskTrigger -AtLogOn
# 3. Daily: $trigger = New-ScheduledTaskTrigger -Daily -At 9am

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

Write-Host "`nScheduled task created successfully!" -ForegroundColor Green
Write-Host "`nTask details:" -ForegroundColor Cyan
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath

Write-Host "`nTo start the task now, run:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White

Write-Host "`nTo view task status:" -ForegroundColor Yellow
Write-Host "  Get-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White

Write-Host "`nTo view task history/logs:" -ForegroundColor Yellow
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'" -ForegroundColor White
Write-Host "  Also check: $BotDirectory\bot-startup.log" -ForegroundColor White
