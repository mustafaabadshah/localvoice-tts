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
* **Side-by-Side Comparison & Benchmark Mode**: Synthesise the same passage on both engines sequentially, compare latency, duration, RTF and peak RAM, audition either voice, and record a one-tap preference (Piper / Kokoro / Tie).
* **Strict Sequential Model Isolation**: Explicit `unload()` cycles and Python garbage collection guarantee that both heavy neural models never co-exist in RAM, maintaining a peak working set under 350 MB on 8 GB systems.
* **Quiet Popup UI**: the panel is a normal toolbar popup that Chrome sizes to its content, so reading never shrinks or covers the page it reads. Controls and facts only — no taglines, helper sentences or secondary labels. State is a dot, a chip and two tabular numbers; long waits are shown as a duration with the cheaper engine one click away. Native light and dark modes.

---

## 💻 Hardware Requirements & Performance

Designed and verified on dual-core Intel Core i3 systems:

* **Processor**: Intel Core i3-7100U (2 cores, 4 threads @ 2.40 GHz) or equivalent
* **Memory**: 8 GB RAM (runs comfortably within a ~260–346 MB peak memory envelope)
* **Graphics**: None required (100% CPU SIMD ONNX execution)
* **Operating System**: Windows 10 / 11, Chrome MV3 (with Edge & Firefox compatibility)
* **Storage**: Any drive or folder. Models are downloaded into `backend/voices/`, synthesised audio is cached in `backend/cache/` (LRU, 250 MB cap). Nothing is written to system folders or the registry.

### Empirical Performance Summary (i3-7100U Dual-Core CPU)

| Engine | Model Type | Parameters | Warm Latency | Warm RTF | Recommended Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Piper TTS** | VITS ONNX | ~15M | **~2.06 s** | **0.20x** | Daily web & email reading, long articles |
| **Kokoro TTS** | StyleTTS2 INT8 | 82M | **~38.12 s** | **8.66x** | Short snippets, audiobooks, voice auditions |

*For complete benchmarks, latency charts, and RAM logs, see [docs/performance_report.md](docs/performance_report.md).*

---

## 🚀 Quick Start Guide

### Step 1: One-Click Environment Setup
From the repository root, in PowerShell:

```powershell
cd localvoice-tts
.\scripts\setup.ps1          # virtualenv + Python deps + default Piper voice + extension build
```

`setup.ps1` downloads the default `en_US-lessac-medium` voice (~63 MB) and its config into
`backend/voices/` — **TTS models are not stored in this repository**, only the code that fetches
and drives them.

Optional — unlock the Kokoro engine (114 MB INT8 model + 54-voice pack):

```powershell
.\scripts\install_kokoro.ps1
```

**Prerequisites:** Windows 10/11 · Python 3.11+ · [uv](https://github.com/astral-sh/uv) · Node.js 18+ · Chrome or Edge.

---

### Step 2: Install the backend controller (recommended)

```powershell
.\scripts\controller.ps1
```

One command, one logon task, and no manual backend management ever again: opening the extension and
pressing **Read Page** starts the backend on demand (~11–15 s for the first Piper load), the popup
gets a ⏻ power row to switch it off, and the engine unloads itself after **15 minutes without use**.

```powershell
.\scripts\controller.ps1 -IdleMinutes 30   # longer auto-off window
.\scripts\controller.ps1 -IdleMinutes 0    # never auto-off
.\scripts\controller.ps1 -Action status    # what the controller sees right now
.\scripts\controller.ps1 -Action uninstall # back to manual start
```

**Why a helper process:** Chrome gives extensions no API for launching a local program, so a browser
alone cannot start a backend. `backend/controller.py` (standard library only) listens on
`127.0.0.1:8766` — loopback only, with the same origin whitelist as the API — and starts/stops the
engine when the extension asks. Details: [V2.7 notes](docs/v2_7_backend_controller.md).

---

### Step 2 (alternative): Run the backend manually

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

The first start takes ~15–25 s while the Piper ONNX voice is loaded into memory, so
`start.ps1` waits up to 90 s before reporting failure. Server output is captured to
`backend\logs\server.out.log` and `backend\logs\server.err.log`; `start.ps1` prints the tail
of both when startup fails. Without the controller, the popup's row shows `Offline` and the command
to fix it.

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
   extension\dist
   ```
   Building from scratch instead? Run `.\scripts\build_extension.ps1` (or `npm install && npm run build`
   inside `extension/`) — it regenerates `extension\dist` from `extension/src`.
5. Pin the **LocalVoice** icon to your Chrome toolbar.
6. Open any article, Gmail message, or the included `test_page.html`, and click the extension icon. LocalVoice opens as a toolbar popup sized to its content; if you click back into the page the popup closes, and reopening it resumes the read where you left it.

---

## 🛠️ Management & Benchmark Scripts

| Script | Purpose |
| :--- | :--- |
| `.\scripts\controller.ps1` | Registers the backend controller as a logon task: the extension starts the backend on demand, and it auto-stops after 15 idle minutes. Supports `-Action status/stop/restart/uninstall` and `-IdleMinutes n`. |
| `.\scripts\setup.ps1` | Creates virtualenv, installs Piper, downloads Lessac voice, and builds extension. |
| `.\scripts\install_kokoro.ps1` | Downloads Kokoro v1.0 INT8 model (114 MB) and 54-voice binary pack (28 MB). |
| `.\scripts\benchmark_engines.ps1` | Runs sequential benchmarks comparing Piper vs Kokoro latency, RTF, and RAM. |
| `.\scripts\diagnose_extraction.ps1` | Tests webpage extraction logic across test HTML files. |
| `.\scripts\test_backend.ps1` | Runs all 15 automated pytest suites covering cache, engines, health, and synthesis. |
| `.\scripts\verify.ps1` | Typechecks and builds the extension, then runs the backend suite — the single gate before committing. |
| `.\scripts\build_extension.ps1` | Runs TypeScript compilation and Vite build with IIFE content-script wrapping. |
| `.\scripts\download_voice.ps1` | Downloads additional Piper community voices by ID. |

---

## 📚 Technical Documentation

* [Engine Comparison & Benchmarks](docs/engine_comparison.md) — Piper vs Kokoro architectures, parameters, RTF, RAM, and licensing.
* [Universal Webpage Extraction](docs/webpage_extraction.md) — Gmail extraction, semantic article parsing, SPA fallbacks, and diagnostics.
* [Performance Report](docs/performance_report.md) — Empirical i3-7100U CPU benchmarks and resource analysis.
* [Architecture Specification](docs/architecture.md) — End-to-end component topology, state machines, and protocols.
* [Implementation Audit](docs/implementation_audit.md) — Baseline audit of initial claims vs empirical measurements.

### Engineering changelog (defects found and fixed)

* [V2.1 Hotfix Report](docs/v2_1_hotfix_report.md) — dead prefetch code, leaked blob URLs, duplicated synthesis requests.
* [V2.2 Prefetch Hand-off Fix](docs/v2_2_prefetch_handoff_fix.md) — duplicate POSTs at paragraph boundaries.
* [V2.2 Kokoro Pace Guard](docs/v2_2_kokoro_pace_guard.md) — why Kokoro is CPU-bound and what the UI promises.
* [V2.3 Audio Pipeline Hardening](docs/v2_3_audio_pipeline_hardening.md) — the `play()` AbortError that killed reads after 5–6 paragraphs, the double-applied speed multiplier, warm start, and the end-to-end latency budget.
* [V2.4 Interface Pass](docs/v2_4_interface_simplification.md) — every helper sentence removed from the panel, replaced by layout, numbers and one context-aware control.
* [V2.5 Popup Surface](docs/v2_5_popup_window.md) — the UI moved out of Chrome's side panel into its own popup window (surface superseded by V2.6; the reasoning is kept as history).
* [V2.6 Action Popup & Session Resume](docs/v2_6_action_popup.md) — the UI is a normal toolbar popup that Chrome sizes to its content, and a read now survives the popup closing: `storage.session` snapshot, restore-on-open, and re-attaching to audio the offscreen player never stopped playing.
* [V2.7 Backend Controller](docs/v2_7_backend_controller.md) — the backend starts and stops itself. A stdlib-only supervisor on `127.0.0.1:8766` (installed as a logon task) wakes the engine on `Failed to fetch`, a ⏻ row in the popup switches it off, and an idle timer unloads it after 15 minutes without use — kept honest by a heartbeat from the offscreen player.

---

## 🔒 Security & Privacy Guarantee

* **127.0.0.1 Binding**: The server listens exclusively on loopback and rejects external network connections.
* **Controller is loopback-only too**: `backend/controller.py` binds `127.0.0.1:8766`, grants CORS only to `chrome-extension://` and loopback origins, and can start/stop nothing but this machine's own backend process.
* **Origin Validation**: Cross-origin requests from arbitrary internet domains are strictly blocked.
* **Zero Cloud Telemetry**: Webpage text, URLs, and audio never leave your local machine.
* **Content Script Sandboxing**: Wrapped in an isolated IIFE preventing global variable leakage and prototype pollution.

---

## 📁 Repository Layout

```text
backend/            FastAPI service (127.0.0.1:8765)
  controller.py     start/stop/idle supervisor the extension talks to (127.0.0.1:8766)
  app/api/          REST endpoints: health, voices, synthesis, engines, compare, metrics, settings
  app/services/     piper_engine, kokoro_engine, engine_manager, audio_cache, voice_manager
  app/utils/        security (origin checks, filename sanitising), logging
  tests/            pytest suites (cache, engines, health, synthesis, voices)
  voices/           downloaded models live here — empty in a fresh clone (git-ignored)
extension/          Chrome MV3 extension (TypeScript + React + Vite)
  src/background/   service worker: message router, offscreen lifecycle
  src/content/      extractor (4-tier hierarchy) + highlighter
  src/ui/           React UI, settings, comparison modal, reading state machine
  src/offscreen/    hidden document that owns the single <audio> element
  src/shared/       types, error classification, engine performance model
docs/               architecture, extraction, benchmarks, and the defect reports above
scripts/            PowerShell setup / controller / start / stop / build / benchmark helpers
artifacts/          recorded benchmark output (JSON) used by the performance report
```

The architecture in one line: **content script** extracts paragraphs → **background** routes
messages → **popup UI** owns the reading state machine, synthesis requests and prefetching →
**offscreen document** plays the audio → **FastAPI backend** synthesises on demand and caches by
hash. See [docs/architecture.md](docs/architecture.md).

Changing something? Read [AGENTS.md](AGENTS.md) first: one-command verification, the six
invariants that must not break, and the UI copy contract the panel is built on.

---

## ⚠️ Honest Limitations

* **Kokoro is slower than real time on dual-core CPUs** (~8.7× RTF; a 30-second paragraph needs
  minutes of CPU). Piper is the intended daily driver — it synthesises ~5× faster than playback,
  so paragraph hand-offs are gapless. See [V2.2 Kokoro Pace Guard](docs/v2_2_kokoro_pace_guard.md).
* **Only one Piper voice ships by default** (`en_US-lessac-medium`). Add more with
  `.\scripts\download_voice.ps1 -VoiceId en_US-amy-medium` (any voice from
  [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)).
* **Windows-first**: the backend is cross-platform Python, but the helper scripts are PowerShell.
* **CPU-only ONNX Runtime**. No CUDA/DirectML execution provider is wired up yet; that is the only
  path to making Kokoro faster than real time on this hardware class.
* **The backend must be running.** The panel reports a readable connection error instead of a raw
  `Failed to fetch`, but it cannot synthesise anything by itself.

---

## 📄 License

The code in this repository is released under the **MIT License** — see [LICENSE](LICENSE).

TTS models are **not** part of this repository, so they keep their own upstream licences:

| Component | Licence |
| :--- | :--- |
| Piper engine (`rhasspy/piper`) | MIT |
| Piper voices (`rhasspy/piper-voices`) | per voice — mostly MIT / CC BY 4.0, check the model card |
| Kokoro-82M (`hexgrad/Kokoro-82M`) | Apache 2.0 |
| Kokoro voice pack (`voices-v1.0.bin`) | Apache 2.0 |

`scripts/setup.ps1` and `scripts/install_kokoro.ps1` download them from their official hosts on
first run; no model weights are redistributed here.

---
