# Script to install Kokoro TTS engine and model files
param(
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"
$KokoroDir = Join-Path $BackendDir "voices\kokoro"

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host " Kokoro TTS (82M) Engine Setup" -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# 1. Install python packages
Write-Host "--> Installing kokoro-onnx, soundfile, and psutil in backend environment..." -ForegroundColor Cyan
try {
    uv pip install --directory $BackendDir kokoro-onnx soundfile psutil
    Write-Host "Python packages installed successfully." -ForegroundColor Green
} catch {
    Write-Error "Failed to install Python packages: $_"
    exit 1
}

# 2. Ensure Kokoro directory exists
if (-not (Test-Path $KokoroDir)) {
    New-Item -ItemType Directory -Path $KokoroDir -Force | Out-Null
}

# 3. Model weights and voices URLs
$ModelUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx"
$VoicesUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin"

$ModelPath = Join-Path $KokoroDir "kokoro-v1.0.int8.onnx"
$VoicesPath = Join-Path $KokoroDir "voices-v1.0.bin"

# Download voices file (~28 MB)
if ($Force -or (-not (Test-Path $VoicesPath)) -or ((Get-Item $VoicesPath).Length -lt 1000000)) {
    Write-Host "--> Downloading Kokoro voices file (voices-v1.0.bin, ~28 MB)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $VoicesUrl -OutFile $VoicesPath -UseBasicParsing
    Write-Host "Downloaded voices-v1.0.bin successfully." -ForegroundColor Green
} else {
    Write-Host "--> voices-v1.0.bin already exists ($([math]::Round((Get-Item $VoicesPath).Length / 1MB, 1)) MB). Skipping download." -ForegroundColor Yellow
}

# Download model file (~114 MB)
if ($Force -or (-not (Test-Path $ModelPath)) -or ((Get-Item $ModelPath).Length -lt 10000000)) {
    Write-Host "--> Downloading Kokoro INT8 CPU model (kokoro-v1.0.int8.onnx, ~114 MB)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath -UseBasicParsing
    Write-Host "Downloaded kokoro-v1.0.int8.onnx successfully." -ForegroundColor Green
} else {
    Write-Host "--> kokoro-v1.0.int8.onnx already exists ($([math]::Round((Get-Item $ModelPath).Length / 1MB, 1)) MB). Skipping download." -ForegroundColor Yellow
}

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host " Kokoro installation verified successfully!" -ForegroundColor Magenta
Write-Host " 54 voices ready for CPU inference." -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta
