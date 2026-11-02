# LocalVoice Implementation Audit Report (V2 Baseline)

**Audit Date**: November 2026  
**Target Platform**: Windows 10/11 (x64)  
**Host Hardware**: Intel Core i3-7100U (2 cores, 4 threads @ 2.40 GHz), 8 GB RAM, Intel HD Graphics 620, No dedicated GPU.  
**Workspace Canonical Path**: `E:\MM Office\Model infrince tts\LocalVoice` (Junctions: `E:\MM Office\LocalVoice`, `E:\MM Office\LFM3-Studio\LocalVoice`)  
**Git Checkpoint**: `d0046b0` ("checkpoint: LocalVoice v1 baseline (audit state)")

---

## 1. Executive Summary & Verification of Previous Claims

Previous documentation contained several aspirational or unverified claims that were subjected to empirical testing on this hardware:

| Metric / Claim | Previous Claim | Empirical Audit Measurement | Finding / Correction |
|---|---|---|---|
| **Process RAM Footprint** | ~70 MB | **WorkingSet: 261.2 MB**, **PrivateBytes: 507.6 MB** | Previous claim only accounted for a hypothetical raw ONNX weight buffer. Python 3.14 + ONNXRuntime + FastAPI server uses ~260 MB Working Set. |
| **Synthesis Latency** | 1.05 s | **2.06 s (Fresh)**, **0.195 s (Cache Hit)** | Fresh synthesis of a 24-word paragraph takes 2.06s (RTF 0.208, 4.8x real-time). Cache hit takes 195 ms. |
| **Automated Tests** | "100% passing" | **9 passed, 0 failed** in 12.58s | Verified with `pytest` via `uv run pytest`. Tests cover basic endpoints, cache eviction, and synthesis. |
| **Network Egress** | Zero egress | **Verified Local-Only** | Server binds to `127.0.0.1:8765`. No remote endpoints contacted during synthesis or voice listing. |
| **Universal Webpage Compatibility** | Universal extraction | **Partial / Conditional** | Standard articles and Gmail work after recent IIFE and selector fixes. Restricted browser pages (`chrome://`, `edge://`) and `file://` URLs without explicit permissions cannot be read. |

---

## 2. Workspace Analysis

An inspection of paths using PowerShell `Get-Item` revealed:
- `E:\MM Office\LocalVoice` is a NTFS Junction pointing to `E:\MM Office\Model infrince tts\LocalVoice`.
- `E:\MM Office\LFM3-Studio\LocalVoice` is a NTFS Junction pointing to `E:\MM Office\Model infrince tts\LocalVoice`.
- `E:\MM Office\Model infrince tts\LocalVoice` is the canonical physical directory on disk.
- All edits target this single canonical physical repository. No duplicate or desynchronized file trees exist.

---

## 3. What Currently Works

1. **FastAPI Backend Core**:
   - `GET /api/v1/health`: Healthy, reports Piper runtime, version, and loaded voice.
   - `GET /api/v1/voices`: Lists installed Piper models (`en_US-lessac-medium`).
   - `POST /api/v1/synthesize`: Synthesizes raw WAV audio via ONNXRuntime CPU.
   - `POST /api/v1/cache/clear`: Bounded LRU audio disk cache (250 MB ceiling).
   - `GET /api/v1/metrics`: Tracks requests, average latency, and cache hit rates.

2. **Extension MV3 Pipeline**:
   - Background service worker (`background.js`) manages sidepanel and tab events.
   - Offscreen audio player (`offscreen.html` + `audio_player.ts`) handles sequential block playback without service-worker timeouts.
   - Content script (`dist/content.js`) is compiled without ES module imports, wrapped in an IIFE to prevent variable declaration collisions, and implements an idempotent message listener.
   - Gmail extraction: Extracts email subject (`h2.hP`) and email body containers (`div.a3s`).
   - Active Tab query: Correctly searches `currentWindow` and `lastFocusedWindow`.

---

## 4. What Does Not Work or Has Architectural Deficiencies

1. **Single Engine Constraint (No Kokoro)**:
   - Backend only knows about `piper_engine.py` and `PiperVoice`.
   - No common `BaseTTSEngine` abstraction exists.
   - No Kokoro engine, dependencies, model management, or voice discovery exist.
   - Extension UI has no engine selector and hardcodes Piper.

2. **Lack of Side-by-Side Comparison / Benchmark Mode**:
   - No endpoint or UI to test the exact same text block sequentially across Piper and Kokoro with metrics (latency, RTF, memory).

3. **Extension Sizing & UI Density**:
   - Popup view was originally sized for side panel; although compact styles were added, popup height and layout need strict tuning to 340–380 px width and 480–560 px height without scrolling.
   - Missing diagnostic panel showing exact extraction details (block counts, selector strategy used, active tab status).

4. **Webpage Extraction Edge Cases**:
   - SPAs with heavy client-side hydration or delayed renders can fail if extracted immediately before DOM nodes settle.
   - Iframes and cross-origin frames are not handled gracefully with informative explanations.
   - When a tab has multiple `<article>` or `<main>` sections, previous logic only checked `mainContainers[0]`.

5. **Resource Management on 8 GB RAM**:
   - If Piper and Kokoro were loaded concurrently, the laptop would suffer from heavy paging and memory pressure.
   - Strict lazy loading and sequential engine switching with explicit garbage collection and memory release are missing.

---

## 5. Security & Privacy Audit

- **CORS**: Currently allows `chrome-extension://*`, `http://localhost:*`, and `http://127.0.0.1:*`. Must ensure strict origin validation.
- **Path Traversal**: `voice_id` is sanitized in `voice_manager.py` using `re.sub(r'[^a-zA-Z0-9_-]', '', voice_id)`.
- **Text Validation**: Enforces 4,000-character maximum block size.
- **Network Boundaries**: Confirmed binding to `127.0.0.1:8765`. Offline operation verified.

---

## 6. Files to Modify vs. Files to Preserve

### Files to Modify:
- `backend/app/config.py`: Add Kokoro model paths, engine configs.
- `backend/app/schemas/requests.py`: Add `engine` parameter to synthesis and comparison schemas.
- `backend/app/schemas/responses.py`: Add engine information, comparison schemas.
- `backend/app/api/synthesis.py`: Route requests through `engine_manager`.
- `backend/app/api/voices.py`: Support `?engine=piper|kokoro`.
- `backend/app/api/health.py`: Report status of both engines.
- `extension/src/shared/types.ts`: Engine types, comparison types.
- `extension/src/sidepanel/App.tsx`: Dual engine selection, benchmark mode, compact layout.
- `extension/src/sidepanel/components/Header.tsx`: Engine toggle.
- `extension/src/sidepanel/components/VoiceSelector.tsx`: Engine-specific voices.
- `extension/src/content/extractor.ts`: Enhanced universal extraction and diagnostics.
- `extension/src/styles/index.css`: Compact 340-380px popup styling.

### New Files to Create:
- `backend/app/services/base_engine.py`: Base abstract class for TTS engines.
- `backend/app/services/kokoro_engine.py`: Kokoro CPU engine implementation.
- `backend/app/services/engine_manager.py`: Central orchestrator for dynamic engine loading/unloading.
- `backend/app/api/engines.py`: `/api/v1/engines` and `/api/v1/engines/select`.
- `backend/app/api/compare.py`: `/api/v1/compare` benchmark endpoint.
- `backend/tests/test_engines.py`: Tests for engine switching, lifecycle, and isolation.
- `extension/src/sidepanel/components/ComparisonModal.tsx`: Side-by-side benchmark UI.
- `extension/src/sidepanel/components/ExtractionDiagnosticsModal.tsx`: Live DOM extraction inspection.
- `scripts/install_kokoro.ps1`: Dedicated, optional Kokoro installation script.
- `scripts/benchmark_engines.ps1`: Automated CLI benchmark script.
- `docs/engine_comparison.md`: Engine specifications and benchmarks.
- `docs/webpage_extraction.md`: DOM extraction strategies and limitations.
- `docs/performance_report.md`: Verified CPU and memory metrics.

### Files to Preserve (Do Not Regress):
- `backend/app/services/piper_engine.py`: Working Piper synthesis.
- `backend/app/services/audio_cache.py`: Working LRU disk cache (update keys to include engine prefix).
- `backend/voices/en_US-lessac-medium.onnx`: Working Piper voice model.
- `extension/src/offscreen/audio_player.ts`: Working audio playback engine.
- `extension/src/background/index.ts`: Working service worker.
