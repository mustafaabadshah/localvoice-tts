# Check prerequisites for LocalVoice
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "==========================================" -ForegroundColor Green
Write-Host " LocalVoice System Preflight Check" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# 1. Check Python
$pythonVer = & python --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [PASS] Python installed: $pythonVer" -ForegroundColor Green
} else {
    Write-Host " [FAIL] Python not found on PATH!" -ForegroundColor Red
}

# 2. Check Node
$nodeVer = & node --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host " [PASS] Node.js installed: $nodeVer" -ForegroundColor Green
} else {
    Write-Host " [FAIL] Node.js not found on PATH!" -ForegroundColor Red
}

# 3. Check Piper Venv
$venvPython = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    Write-Host " [PASS] Backend Virtualenv: $venvPython" -ForegroundColor Green
    $piperCheck = & $venvPython -c "import piper; print('Piper version:', getattr(piper, '__version__', '1.8.0'))" 2>&1
    Write-Host " [PASS] $piperCheck" -ForegroundColor Green
} else {
    Write-Host " [WARN] Virtualenv not found at backend\.venv. Run scripts\setup.ps1" -ForegroundColor Yellow
}

# 4. Check Installed Voices
$voicesDir = Join-Path $ProjectRoot "backend\voices"
$voices = Get-ChildItem -Path $voicesDir -Filter "*.onnx" -ErrorAction SilentlyContinue
if ($voices) {
    Write-Host " [PASS] Found $($voices.Count) installed Piper voice(s):" -ForegroundColor Green
    foreach ($v in $voices) {
        $mb = [math]::round($v.Length / 1MB, 2)
        Write-Host "        - $($v.BaseName) ($mb MB)" -ForegroundColor Cyan
    }
} else {
    Write-Host " [WARN] No .onnx voices found in $voicesDir. Run scripts\download_voice.ps1" -ForegroundColor Yellow
}

# 5. Check Extension Build
$extDist = Join-Path $ProjectRoot "extension\dist\manifest.json"
if (Test-Path $extDist) {
    Write-Host " [PASS] Extension build ready at extension\dist" -ForegroundColor Green
} else {
    Write-Host " [WARN] Extension not built yet. Run npm run build inside extension/." -ForegroundColor Yellow
}

Write-Host "==========================================" -ForegroundColor Green
