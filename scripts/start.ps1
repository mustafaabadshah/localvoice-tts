# Start the LocalVoice Python Backend
# Idempotent: no-ops if the backend is already healthy. Stop it with .\scripts\stop.ps1
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$backendDir = Join-Path $ProjectRoot "backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$runner = Join-Path $backendDir "run_server.py"
$logDir = Join-Path $backendDir "logs"
$outLog = Join-Path $logDir "server.out.log"
$errLog = Join-Path $logDir "server.err.log"
$healthUrl = "http://127.0.0.1:8765/api/v1/health"

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Starting LocalVoice Piper Backend..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# Check if already running
try {
    $existing = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($existing.status -eq "healthy" -or $existing.status -eq "degraded") {
        Write-Host " [INFO] LocalVoice backend is already running on http://127.0.0.1:8765" -ForegroundColor Yellow
        Write-Host " Engine: $($existing.active_engine) | Voices: $($existing.installed_voices_count) | Version: $($existing.version)" -ForegroundColor Cyan
        exit 0
    }
} catch {}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host " [ERROR] Virtualenv python not found: $venvPython" -ForegroundColor Red
    Write-Host "         Run .\scripts\setup.ps1 first." -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Green
    exit 1
}

if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Start backend process in background, capturing stdout/stderr so failures are diagnosable.
# NOTE: Start-Process joins -ArgumentList without quoting, so a project path containing
# spaces (e.g. "E:\MM Office\...") must be quoted explicitly or python receives "E:\MM".
$quotedRunner = '"' + $runner + '"'
$proc = Start-Process -FilePath $venvPython `
    -ArgumentList $quotedRunner `
    -WorkingDirectory $backendDir `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

Write-Host "Process spawned (PID: $($proc.Id)). Waiting for health check..." -ForegroundColor Cyan
Write-Host "Logs: $outLog" -ForegroundColor DarkGray

# Poll health for up to 90s: the first Piper ONNX load takes ~15-25s on CPU, and a
# cold onnxruntime import can take noticeably longer than that on this class of box.
$started = $false
for ($i = 0; $i -lt 180; $i++) {
    if ($proc.HasExited) { break }
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5 -ErrorAction Stop
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
    Write-Host " Engine:        $($health.active_engine) | Voices: $($health.installed_voices_count)" -ForegroundColor Cyan
} else {
    Write-Host " [ERROR] Backend did not become healthy. Recent output:" -ForegroundColor Red
    Write-Host " --- $errLog ---" -ForegroundColor DarkGray
    Get-Content -LiteralPath $errLog -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
    Write-Host " --- $outLog ---" -ForegroundColor DarkGray
    Get-Content -LiteralPath $outLog -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
    if (-not $proc.HasExited) {
        Write-Host " [INFO] PID $($proc.Id) is still running but not answering. Stop it with: .\scripts\stop.ps1" -ForegroundColor Yellow
    } else {
        $code = "unknown"
        try { $code = $proc.ExitCode } catch {}
        Write-Host " [INFO] PID $($proc.Id) exited with code $code." -ForegroundColor Yellow
    }
    Write-Host "==========================================" -ForegroundColor Green
    exit 1
}
Write-Host "==========================================" -ForegroundColor Green
