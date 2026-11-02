# Script to build Chrome extension
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ExtDir = Join-Path $ProjectRoot "extension"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building LocalVoice Chrome Extension" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Set-Location $ExtDir
try {
    npm run build
    Write-Host "`nExtension built successfully into: $ExtDir\dist" -ForegroundColor Green
    Write-Host "Load unpacked extension in chrome://extensions using the directory above." -ForegroundColor Yellow
} finally {
    Set-Location $ProjectRoot
}
