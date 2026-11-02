# Stop the LocalVoice Python Backend
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$pidFile = Join-Path $ProjectRoot "backend\server.pid"

Write-Host "Stopping LocalVoice Backend..." -ForegroundColor Yellow

$stopped = $false

# 1. Try PID file
if (Test-Path $pidFile) {
    try {
        $pidNum = [int](Get-Content $pidFile).Trim()
        $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $pidNum -Force
            Write-Host "Stopped process by PID: $pidNum" -ForegroundColor Green
            $stopped = $true
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    } catch {}
}

# 2. Fallback: Search for run_server processes
$processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*run_server.py*" }
foreach ($p in $processes) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped process ID: $($p.ProcessId)" -ForegroundColor Green
    $stopped = $true
}

if ($stopped) {
    Write-Host "LocalVoice Backend has been stopped." -ForegroundColor Green
} else {
    Write-Host "No active LocalVoice backend process found." -ForegroundColor Gray
}
