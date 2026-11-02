param(
    [string]$VoiceId = "en_US-lessac-medium"
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$voicesDir = Join-Path $ProjectRoot "backend\voices"
New-Item -ItemType Directory -Force $voicesDir | Out-Null

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Downloading Piper Voice: $VoiceId" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# Parse language code, speaker name, and quality from voice ID
# Format: lang_REGION-speaker-quality (e.g., en_US-lessac-medium)
$parts = $VoiceId -split "-"
if ($parts.Count -lt 3) {
    Write-Host "Invalid voice ID format. Expected: lang_REGION-speaker-quality (e.g. en_US-lessac-medium)" -ForegroundColor Red
    exit 1
}

$langCode = $parts[0]
$langPrefix = $langCode.Split("_")[0]
$speaker = $parts[1]
$quality = $parts[2]

$baseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/$langPrefix/$langCode/$speaker/$quality"
$modelUrl = "$baseUrl/$VoiceId.onnx"
$configUrl = "$baseUrl/$VoiceId.onnx.json"

$destModel = Join-Path $voicesDir "$VoiceId.onnx"
$destConfig = Join-Path $voicesDir "$VoiceId.onnx.json"

Write-Host "Downloading model: $modelUrl" -ForegroundColor Cyan
Invoke-WebRequest -Uri $modelUrl -OutFile $destModel
Write-Host "Downloading config: $configUrl" -ForegroundColor Cyan
Invoke-WebRequest -Uri $configUrl -OutFile $destConfig

if ((Test-Path $destModel) -and (Test-Path $destConfig)) {
    $mb = [math]::round((Get-Item $destModel).Length / 1MB, 2)
    Write-Host " [SUCCESS] Downloaded voice '$VoiceId' ($mb MB) to backend\voices\" -ForegroundColor Green
} else {
    Write-Host " [ERROR] Download failed. Verify voice name on Hugging Face rhasspy/piper-voices." -ForegroundColor Red
}
