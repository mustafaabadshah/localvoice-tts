# Start the LocalVoice Python Backend
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$backendDir = Join-Path $ProjectRoot "backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$runner = Join-Path $backendDir "run_server.py"

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Starting LocalVoice Piper Backend..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# Check if already running
try {
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/v1/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($existing.status -eq "healthy" -or $existing.status -eq "degraded") {
        Write-Host " [INFO] LocalVoice backend is already running on http://127.0.0.1:8765" -ForegroundColor Yellow
        exit 0
    }
} catch {}

# Start backend process in background
$proc = Start-Process -FilePath $venvPython -ArgumentList $runner -WorkingDirectory $backendDir -PassThru -WindowStyle Hidden

Write-Host "Process spawned (PID: $($proc.Id)). Waiting for health check..." -ForegroundColor Cyan

# Poll health check for up to 30 seconds (allows initial ONNX model load on CPU)
$started = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/v1/health" -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq "healthy" -or $health.status -eq "degraded") {
            $started = $true
            break
        }
    } catch {}
}

if ($started) {
    Write-Host " [SUCCESS] LocalVoice Backend is ONLINE!" -ForegroundColor Green
    Write-Host " URL:           http://127.0.0.1:8765" -ForegroundColor Cyan
    Write-Host " Health Check:  http://127.0.0.1:8765/api/v1/health" -ForegroundColor Cyan
    Write-Host " API Docs:      http://127.0.0.1:8765/docs" -ForegroundColor Cyan
    Write-Host " Process ID:    $($proc.Id)" -ForegroundColor Cyan
} else {
    Write-Host " [ERROR] Backend failed to start within timeout. Check logs." -ForegroundColor Red
}
Write-Host "==========================================" -ForegroundColor Green
