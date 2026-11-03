# LocalVoice — Architectural Specification & Design

## 1. Architectural Philosophy & First Principles
LocalVoice is designed from the ground up for strict local privacy, minimal resource footprint, and zero cloud reliance:
1. **Zero Network Egress**: User webpage text, browsing URLs, and generated speech never leave `127.0.0.1`.
2. **CPU-Bound Optimization**: Specifically engineered for dual-core Intel Core i3 / 8 GB RAM machines without dedicated GPUs.
3. **Bounded Memory & Disk Footprint**:
   - Only **one voice model** is loaded in RAM at any given moment (~60–100 MB).
   - Audio is generated incrementally (one paragraph at a time), avoiding memory spikes.
   - Generated speech is cached on disk using SHA-256 keys with an LRU eviction threshold of **250 MB**.
4. **Decoupled Client-Server Protocol**:
   - **Backend**: FastAPI + Piper TTS daemon bound exclusively to `127.0.0.1:8765`.
   - **Frontend**: Chrome Manifest V3 extension featuring a standalone popup-window UI and Offscreen Audio Playback.

---

## 2. Component Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER (MV3)                            │
│                                                                        │
│   ┌──────────────────┐    Message     ┌────────────────────────────┐  │
│   │   Content Script │◄──────────────►│      Popup UI (React)      │  │
│   │ (DOM Extractor & │                │ (State Machine, Controls,  │  │
│   │   Highlighter)   │                │   Voice/Speed Selector)    │  │
│   └──────────────────┘                └─────────────┬──────────────┘  │
│                                                     │                 │
│                                            Post     │ Audio           │
│                                            Request  │ Response        │
│                                                     ▼                 │
│                                       ┌────────────────────────────┐  │
│                                       │  Offscreen Document        │  │
│                                       │ (HTML5 Audio Player)       │  │
│                                       └────────────────────────────┘  │
└─────────────────────────────────────────────┬──────────────────────────┘
                                              │ HTTP REST (127.0.0.1:8765)
                                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   LOCALVOICE PYTHON BACKEND DAEMON                     │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ FastAPI Endpoints:                                             │   │
│   │ - GET  /api/v1/health       - POST /api/v1/synthesize          │   │
│   │ - GET  /api/v1/voices       - POST /api/v1/voices/test         │   │
│   │ - GET  /api/v1/settings     - GET  /api/v1/metrics             │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    ▼                                   │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ PiperEngine Service                                            │   │
│   │ - Dynamic Voice Manager (Scans backend/voices/*.onnx)          │   │
│   │ - Bounded Disk Cache (250 MB LRU Cache)                        │   │
│   │ - Piper TTS + ONNX Runtime (CPU SIMD Execution)                │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Reading Flow & State Machine

```
   ┌─────────┐
   │  IDLE   │
   └────┬────┘
        │ User clicks "Read Page"
        ▼
   ┌──────────────┐
   │  EXTRACTING  │ (Traverses article DOM, filters ads/nav, builds TextBlocks)
   └────┬─────────┘
        │ Blocks extracted
        ▼
   ┌──────────────┐
   │    READY     │
   └────┬─────────┘
        │ Starts first paragraph
        ▼
   ┌──────────────┐
   │ SYNTHESIZING │◄──────────────────────────────┐
   └────┬─────────┘                               │
        │ Audio generated / Cache hit             │
        ▼                                         │
   ┌──────────────┐                               │
   │   PLAYING    │──(User clicks Pause)──►┌────────────┐
   └────┬─────────┘                        │   PAUSED   │
        │ Audio finishes ('ended' event)   └────────────┘
        ▼
   [ Next Block Available? ] ──► YES ──► (Increment Index)
        │
        NO
        ▼
   ┌──────────────┐
   │  COMPLETED   │ (Clears highlights, resets to top)
   └──────────────┘
```

---

## 4. Security & Isolation Measures
1. **Loopback Only**: Server binds strictly to `127.0.0.1:8765`.
2. **Origin Validation Middleware**: Requests with external web origins are rejected with `403 Forbidden`.
3. **Path Traversal Prevention**: Voice IDs and file paths are strictly sanitized with regex `^[a-zA-Z0-9_\-\.]+$`.
4. **Content Script Safety**: Content script only highlights elements and scrolls smoothly; it never executes `eval()` or imports external scripts.
