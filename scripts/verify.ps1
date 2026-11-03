# One command that answers "is this repo healthy?":
#   1. extension typecheck + production build (tsc && vite build)
#   2. backend pytest suite
# Runs both halves even for a single-sided change, because the panel imports shared
# modules (enginePerf, errors) that the backend suites also cover.
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ExtDir = Join-Path $ProjectRoot "extension"
$BackendDir = Join-Path $ProjectRoot "backend"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " LocalVoice Verification" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Set-Location $ExtDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n[FAIL] Extension typecheck / build (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "`n[PASS] Extension typecheck + build" -ForegroundColor Green
} finally {
    Set-Location $ProjectRoot
}

uv run --directory $BackendDir pytest -q
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FAIL] Backend tests (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "`n[PASS] Backend tests" -ForegroundColor Green

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Verification passed" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
