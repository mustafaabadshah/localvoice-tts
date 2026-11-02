# Script to run all backend pytest automated tests
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Running LocalVoice Backend Tests" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

uv run --directory $BackendDir pytest -v
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend tests failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host "`nAll backend tests passed successfully!" -ForegroundColor Green
