# Complete setup script for LocalVoice
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Setting up LocalVoice (Backend & Extension)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# 1. Setup Backend Python Environment
Write-Host "--> Configuring Python backend..." -ForegroundColor Cyan
$backendDir = Join-Path $ProjectRoot "backend"
$venvDir = Join-Path $backendDir ".venv"

if (-not (Test-Path $venvDir)) {
    Write-Host "Creating virtualenv with uv..."
    uv venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$reqFile = Join-Path $backendDir "requirements.txt"

Write-Host "Installing backend Python packages..."
uv pip install -r $reqFile --python $venvPython

# 2. Check / Download Default Voice
$voicesDir = Join-Path $backendDir "voices"
$defaultVoice = Join-Path $voicesDir "en_US-lessac-medium.onnx"
if (-not (Test-Path $defaultVoice)) {
    Write-Host "Downloading default English voice (en_US-lessac-medium)..." -ForegroundColor Yellow
    & "$ScriptDir\download_voice.ps1" -VoiceId "en_US-lessac-medium"
}

# 3. Setup Extension
Write-Host "--> Building Chrome Extension..." -ForegroundColor Cyan
$extDir = Join-Path $ProjectRoot "extension"
Set-Location $extDir

npm install
npm run build

Set-Location $ProjectRoot
Write-Host "==========================================" -ForegroundColor Green
Write-Host " LocalVoice setup completed successfully!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "To start the backend server, run: .\scripts\start.ps1" -ForegroundColor Yellow
Write-Host "To load the Chrome extension:" -ForegroundColor Yellow
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Enable 'Developer mode'"
Write-Host "  3. Click 'Load unpacked' and select: $extDir\dist"
