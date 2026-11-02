# LocalVoice V2 🎙️

> **A fully local, privacy-first webpage read-aloud system powered by Dual TTS Engines (Piper + Kokoro).**  
> Zero cloud APIs. Zero subscriptions. Zero tracking. 100% CPU-optimized.

LocalVoice reads entire webpages naturally, exactly as written, paragraph by paragraph, with visible in-page highlighting, automatic scrolling, live DOM diagnostics, and instant side-by-side voice benchmarking.

---

## 🌟 What's New in LocalVoice V2

* **Dual TTS Engine Architecture**: Seamlessly switch between **Piper TTS** (VITS architecture for high-speed, low-latency streaming) and **Kokoro TTS** (82M parameter StyleTTS2 architecture for studio-grade human naturalness).
* **55 Local Voices**: 1 high-speed Piper voice (`en_US-lessac-medium`) + 54 diverse Kokoro voice styles (American, British, and international accents).
* **Universal Webpage Extractor**: 4-tier extraction hierarchy that accurately parses **Google Gmail active email views**, HTML5 semantic articles, SPA leaf nodes, and selected text snippets.
* **Live Extraction Diagnostics**: Inspect extracted DOM metadata (blocks, character/word counts, duration, and selector strategies) with a single click.
* **Side-by-Side Comparison & Benchmark Mode**: Test both engines on identical passages sequentially, compare latency, duration, and RTF, and audition voices side-by-side with 5-star ratings.
* **Strict Sequential Model Isolation**: Explicit `unload()` cycles and Python garbage collection guarantee that both heavy neural models never co-exist in RAM, maintaining a peak working set under 350 MB on 8 GB systems.
* **Compact Extension Interface**: Pixel-perfect traditional popup layout (350 px width) with native responsive dark and light modes.

---

## 💻 Hardware Requirements & Performance

Designed and verified on dual-core Intel Core i3 systems:

* **Processor**: Intel Core i3-7100U (2 cores, 4 threads @ 2.40 GHz) or equivalent
* **Memory**: 8 GB RAM (runs comfortably within a ~260–346 MB peak memory envelope)
* **Graphics**: None required (100% CPU SIMD ONNX execution)
* **Operating System**: Windows 10 / 11, Chrome MV3 (with Edge & Firefox compatibility)
* **Storage**: Secondary volume supported (`E:\MM Office\Model infrince tts\LocalVoice`) with zero C: drive disk pollution.

### Empirical Performance Summary (i3-7100U Dual-Core CPU)

| Engine | Model Type | Parameters | Warm Latency | Warm RTF | Recommended Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Piper TTS** | VITS ONNX | ~15M | **~2.06 s** | **0.20x** | Daily web & email reading, long articles |
| **Kokoro TTS** | StyleTTS2 INT8 | 82M | **~38.12 s** | **8.66x** | Short snippets, audiobooks, voice auditions |

*For complete benchmarks, latency charts, and RAM logs, see [docs/performance_report.md](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/performance_report.md).*

---

## 🚀 Quick Start Guide

### Step 1: One-Click Environment Setup
From PowerShell:
```powershell
cd "E:\MM Office\Model infrince tts\LocalVoice"
.\scripts\setup.ps1
```
To install Kokoro TTS INT8 and its 54 voice models:
```powershell
.\scripts\install_kokoro.ps1
```

---

### Step 2: Start the Backend Daemon
```powershell
.\scripts\start.ps1
```
* **Backend REST API**: `http://127.0.0.1:8765`
* **Health & Diagnostics**: `http://127.0.0.1:8765/api/v1/health`
* **Interactive OpenAPI Docs**: `http://127.0.0.1:8765/docs`

To stop the backend daemon:
```powershell
.\scripts\stop.ps1
```

---

### Step 3: Load the Extension into Google Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** (toggle switch in the top-right corner).
3. Click **Load unpacked** (top-left button).
4. Select the built extension directory:
   ```text
   E:\MM Office\Model infrince tts\LocalVoice\extension\dist
   ```
5. Pin the **LocalVoice** icon to your Chrome toolbar.
6. Open any article, Gmail message, or the included `test_page.html`, and click the extension icon to begin listening!

---

## 🛠️ Management & Benchmark Scripts

| Script | Purpose |
| :--- | :--- |
| `.\scripts\setup.ps1` | Creates virtualenv, installs Piper, downloads Lessac voice, and builds extension. |
| `.\scripts\install_kokoro.ps1` | Downloads Kokoro v1.0 INT8 model (114 MB) and 54-voice binary pack (28 MB). |
| `.\scripts\benchmark_engines.ps1` | Runs sequential benchmarks comparing Piper vs Kokoro latency, RTF, and RAM. |
| `.\scripts\diagnose_extraction.ps1` | Tests webpage extraction logic across test HTML files. |
| `.\scripts\test_backend.ps1` | Runs all 15 automated pytest suites covering cache, engines, health, and synthesis. |
| `.\scripts\build_extension.ps1` | Runs TypeScript compilation and Vite build with IIFE content-script wrapping. |
| `.\scripts\download_voice.ps1` | Downloads additional Piper community voices by ID. |

---

## 📚 Technical Documentation

* [Engine Comparison & Benchmarks](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/engine_comparison.md) — Piper vs Kokoro architectures, parameters, RTF, RAM, and licensing.
* [Universal Webpage Extraction](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/webpage_extraction.md) — Gmail extraction, semantic article parsing, SPA fallbacks, and diagnostics.
* [Performance Report](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/performance_report.md) — Empirical i3-7100U CPU benchmarks and resource analysis.
* [Architecture Specification](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/architecture.md) — End-to-end component topology, state machines, and protocols.
* [Implementation Audit](file:///E:/MM%20Office/LFM3-Studio/LocalVoice/docs/implementation_audit.md) — Baseline audit of initial claims vs empirical measurements.

---

## 🔒 Security & Privacy Guarantee

* **127.0.0.1 Binding**: The server listens exclusively on loopback and rejects external network connections.
* **Origin Validation**: Cross-origin requests from arbitrary internet domains are strictly blocked.
* **Zero Cloud Telemetry**: Webpage text, URLs, and audio never leave your local machine.
* **Content Script Sandboxing**: Wrapped in an isolated IIFE preventing global variable leakage and prototype pollution.
