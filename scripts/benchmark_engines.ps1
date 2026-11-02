# Script to benchmark Piper and Kokoro engines side-by-side
param(
    [string]$Text = "In an era dominated by edge computing, running neural networks locally on commodity laptops marks a major transition toward digital sovereignty.",
    [string]$PiperVoice = "en_US-lessac-medium",
    [string]$KokoroVoice = "af_heart",
    [float]$Speed = 1.0,
    [string]$BackendUrl = "http://127.0.0.1:8765"
)

$ErrorActionPreference = "Stop"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " LocalVoice Dual Engine Benchmark" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Input Text: '$Text'" -ForegroundColor Gray
Write-Host "Piper Voice: $PiperVoice"
Write-Host "Kokoro Voice: $KokoroVoice"
Write-Host "Speed: $Speed"
Write-Host ""

$body = @{
    text = $Text
    piper_voice_id = $PiperVoice
    kokoro_voice_id = $KokoroVoice
    speed = $Speed
} | ConvertTo-Json

try {
    Write-Host "--> Requesting sequential comparison from backend..." -ForegroundColor Yellow
    $response = Invoke-RestMethod -Uri "$BackendUrl/api/v1/compare" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 120
    
    Write-Host "`n[BENCHMARK RESULTS]" -ForegroundColor Green
    Write-Host "Word Count:      $($response.word_count) words ($($response.character_count) characters)"
    
    Write-Host "`n--- PIPER TTS ---" -ForegroundColor Cyan
    Write-Host "Status:          $($response.piper.status)"
    Write-Host "Synthesis Time:  $($response.piper.synthesis_time_seconds) s"
    Write-Host "Audio Duration:  $($response.piper.audio_duration_seconds) s"
    Write-Host "Real-Time Factor:$($response.piper.real_time_factor) (synthesis time / audio duration)"
    Write-Host "Peak Memory:     $($response.piper.peak_memory_mb) MB"
    Write-Host "Cache Hit:       $($response.piper.cache_hit)"
    Write-Host "Audio URL:       $BackendUrl$($response.piper.audio_url)"

    Write-Host "`n--- KOKORO TTS ---" -ForegroundColor Magenta
    Write-Host "Status:          $($response.kokoro.status)"
    if ($response.kokoro.status -eq "success") {
        Write-Host "Synthesis Time:  $($response.kokoro.synthesis_time_seconds) s"
        Write-Host "Audio Duration:  $($response.kokoro.audio_duration_seconds) s"
        Write-Host "Real-Time Factor:$($response.kokoro.real_time_factor) (synthesis time / audio duration)"
        Write-Host "Peak Memory:     $($response.kokoro.peak_memory_mb) MB"
        Write-Host "Cache Hit:       $($response.kokoro.cache_hit)"
        Write-Host "Audio URL:       $BackendUrl$($response.kokoro.audio_url)"
    } else {
        Write-Host "Error:           $($response.kokoro.error)" -ForegroundColor Red
    }

    # Save benchmark to artifacts/benchmarks/
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ProjectRoot = Split-Path -Parent $ScriptDir
    $BenchDir = Join-Path $ProjectRoot "artifacts\benchmarks"
    if (-not (Test-Path $BenchDir)) {
        New-Item -ItemType Directory -Path $BenchDir -Force | Out-Null
    }

    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $jsonPath = Join-Path $BenchDir "benchmark_$timestamp.json"
    $response | ConvertTo-Json -Depth 6 | Out-File -FilePath $jsonPath -Encoding utf8
    Write-Host "`nSaved benchmark JSON report to: $jsonPath" -ForegroundColor Green

} catch {
    Write-Error "Benchmark failed: $_"
    exit 1
}
