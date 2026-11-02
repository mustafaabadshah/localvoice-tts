# Script to diagnose content extraction on test page or local server
param(
    [string]$Url = "http://127.0.0.1:8765/api/v1/health"
)

Write-Host "==========================================" -ForegroundColor Yellow
Write-Host " LocalVoice Extraction Diagnostics" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow

# Test Backend Health
try {
    $health = Invoke-RestMethod -Uri $Url -TimeoutSec 5
    Write-Host "Backend Status:        $($health.status)" -ForegroundColor Green
    Write-Host "Active TTS Engine:     $($health.active_engine)"
    Write-Host "Piper Runtime:         $($health.piper_runtime) ($($health.piper_installed_voices) voices)"
    Write-Host "Kokoro Runtime:        $($health.kokoro_runtime) ($($health.kokoro_installed_voices) voices)"
    Write-Host "CPU Execution:         $($health.cpu_execution)"
} catch {
    Write-Host "Backend is OFFLINE at $Url" -ForegroundColor Red
    Write-Host "Start the server first with: .\scripts\start.ps1" -ForegroundColor Yellow
    exit 1
}

# Check Extension content.js build
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ContentJs = Join-Path $ProjectRoot "extension\dist\content.js"

if (Test-Path $ContentJs) {
    $content = Get-Content $ContentJs -Raw
    $hasIIFE = $content.Trim().StartsWith("(() => {")
    $hasImports = $content.Contains("import ") -or $content.Contains("import{")
    
    Write-Host "`n--- CONTENT SCRIPT STATUS ---" -ForegroundColor Cyan
    Write-Host "File exists:           True ($([math]::Round((Get-Item $ContentJs).Length / 1KB, 2)) KB)"
    Write-Host "IIFE Wrapped:          $hasIIFE" -ForegroundColor $(if ($hasIIFE) { "Green" } else { "Red" })
    Write-Host "Zero ES Imports:       $(-not $hasImports)" -ForegroundColor $(if (-not $hasImports) { "Green" } else { "Red" })
} else {
    Write-Host "dist/content.js not found. Run .\scripts\build_extension.ps1" -ForegroundColor Red
}

Write-Host "`nTo inspect a live webpage in Chrome:" -ForegroundColor Cyan
Write-Host "1. Open any webpage (e.g. Gmail or an article)."
Write-Host "2. Click LocalVoice icon in Chrome toolbar."
Write-Host "3. Click the Diagnostics icon (stethoscope) in the header to view live DOM diagnostics."
