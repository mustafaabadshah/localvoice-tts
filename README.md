# LocalVoice 🎙️

> **A fully local, privacy-first webpage read-aloud system powered by Piper TTS.**  
> Zero cloud APIs. Zero subscriptions. Zero tracking. 100% CPU-optimized.

LocalVoice reads entire webpages naturally, exactly as written, paragraph by paragraph, with visible in-page highlighting and automatic smooth scrolling.

---

## 🌟 Key Features

* **100% Local Speech Synthesis**: Uses **Piper TTS** with ONNX Runtime CPU SIMD execution.
* **Chrome Manifest V3 Side Panel**: Modern React + TypeScript extension interface accessible right inside your browser window.
* **Paragraph-by-Paragraph Highlighting**: Highlights the exact paragraph currently spoken with a subtle amber border and scrolls smoothly.
* **Selection Reading**: Select any sentence or block on a webpage and read just the selection.
* **Bounded Audio Cache**: Reuses identical generated paragraphs instantly (250 MB LRU disk cache).
* **Speed Multipliers**: Granular speed adjustment (0.75x, 0.90x, 1.00x, 1.10x, 1.25x, 1.50x, 1.75x, 2.00x).
* **Dynamic Voice Discovery**: Scans local voice directory for any installed Piper voice model without hardcoded lists.
* **Decoupled Architecture**: Prepared for cross-browser support (Edge and Firefox).

---

## 💻 Hardware Prerequisites

LocalVoice is specifically engineered to run comfortably on standard, everyday hardware:
* **Operating System**: Windows 10 / 11 (or Linux / macOS)
* **CPU**: Dual-core Intel Core i3 (e.g. i3-7100U) or better
* **RAM**: 8 GB RAM (runs in ~68 MB RAM footprint)
* **GPU**: None required (pure CPU execution)
* **Software**: Python 3.12+ and Node.js v18+

---

## 🚀 Quick Start Guide

### Step 1: One-Click Setup
Open PowerShell and run the setup script:

```powershell
cd "E:\MM Office\Model infrince tts\LocalVoice"
.\scripts\setup.ps1
```
This script automatically:
1. Creates a Python virtual environment at `backend\.venv`.
2. Installs all required dependencies (`fastapi`, `piper-tts`, `onnxruntime`, etc.).
3. Downloads the high-quality default English voice (`en_US-lessac-medium`).
4. Installs Node dependencies and builds the Chrome extension into `extension\dist\`.

---

### Step 2: Start the Backend Server

```powershell
.\scripts\start.ps1
```
* **Backend URL**: `http://127.0.0.1:8765`
* **Health Check**: `http://127.0.0.1:8765/api/v1/health`
* **Interactive Docs**: `http://127.0.0.1:8765/docs`

To stop the server at any time:
```powershell
.\scripts\stop.ps1
```

---

### Step 3: Load the Extension into Google Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the extension build directory:
   ```text
   E:\MM Office\Model infrince tts\LocalVoice\extension\dist
   ```
5. Pin the **LocalVoice** icon to your Chrome toolbar.
6. Open any article or the included [test_page.html](file:///e:/MM%20Office/Model%20infrince%20tts/LocalVoice/test_page.html) and click the icon to open the Side Panel!

---

## 🗣️ Managing & Downloading Voices

LocalVoice dynamically scans `backend/voices/` for `.onnx` and `.onnx.json` files. 

You can download additional official voices anytime using the helper script:

```powershell
# Download Amy (English US Medium)
.\scripts\download_voice.ps1 -VoiceId "en_US-amy-medium"

# Download Thorsten (German Medium)
.\scripts\download_voice.ps1 -VoiceId "de_DE-thorsten-medium"

# Download Davefx (Spanish Medium)
.\scripts\download_voice.ps1 -VoiceId "es_ES-davefx-medium"
```
The new voice will immediately appear in the extension dropdown!

---

## 🧪 Running Automated Tests

Run the complete backend test suite:

```powershell
.\backend\.venv\Scripts\pytest.exe .\backend\tests -v
```

All 9 unit tests verify:
* API health & diagnostics
* Voice discovery & path traversal security
* Speech synthesis WAV byte validation
* LRU bounded disk cache limits and eviction

---

## 🔒 Security & Privacy Guarantee

* **127.0.0.1 Binding**: The server refuses connections from external networks.
* **Origin Checking**: Cross-Origin requests from arbitrary public websites are strictly blocked.
* **No Content Logging**: Full webpage texts are never written to log files.
* **Zero Telemetry**: No tracking, analytics, or external phone-home requests.
