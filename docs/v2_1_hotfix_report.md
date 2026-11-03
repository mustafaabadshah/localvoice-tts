# LocalVoice V2.1 — Verification & Hotfix Report

**Date**: November 3, 2026
**Hardware**: Intel Core i3-7100U (2 cores / 4 threads @ 2.40 GHz), 8 GB RAM, no GPU
**Canonical Path**: `E:\MM Office\Model infrince tts\LocalVoice`
**Git Baseline Audited**: `ba02c1b` ("fix: persistent sidepanel layout, instant Piper engine switching, and Kokoro CPU tuning")
**Method**: Static audit of the V2 completion reports against the actual source, followed by live backend runs (HTTP + pytest).

---

## 1. Verification of the V2 Handoff Claims

| Claim from the V2 report | Verified | Evidence |
|---|---|---|
| Side panel no longer closes on page click | **Yes** | `extension/public/manifest.json` has no `default_popup`; `side_panel.default_path` plus `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in `src/background/index.ts` |
| Content script is IIFE-wrapped with a singleton listener | **Yes** | `vite.config.ts::wrapContentScriptPlugin`; built `dist/content.js` ends with `})();` and registers `LOCALVOICE_LISTENER` exactly once |
| Engine switcher is never disabled | **Yes** | `Header.tsx` buttons carry no `disabled` attribute |
| Frontend aborts in-flight synthesis on switch | **Yes** | `ReadingEngine.switchEngine()` aborts `abortController`, sends `STOP_AUDIO`, resets state |
| Piper voice id sent to Kokoro falls back safely | **Yes** | `KokoroEngine.synthesize()` validates against `get_voices()` and falls back to `af_heart` |
| Audio cache keys are engine-separated | **Yes** | `AudioCache.compute_key()` includes the engine in the SHA-256 payload |
| ONNX CPU session tuning applied | **Yes** | `KokoroEngine._get_kokoro()` sets `ORT_ENABLE_ALL`, `ORT_SEQUENTIAL`, `intra_op_num_threads = min(4, cpu_count)` |
| Four-tier extraction (selection, Gmail, article, SPA leaves) | **Yes** | `src/content/extractor.ts` |

The documented architecture is real. Three further defects were found that the reports did not cover, and one of them directly undermined the measured Kokoro performance.

---

## 2. Defect 1 — `/health` built a full Kokoro ONNX session on every poll (critical)

**Symptom**: the backend was permanently busy. Kokoro synthesis looked far slower than the published benchmark and the extension felt sluggish whenever it was open.

**Root cause**: when the model was not resident, `KokoroEngine.list_voices()` did this:

```python
k = Kokoro(str(self.model_path), str(self.voices_path))   # full 82M ONNX session
temp_voices = k.get_voices()
```

`list_voices()` is called by `health_check()`, which is called by `GET /api/v1/health` — and the side panel polls that endpoint **every 5 seconds** (`App.tsx`: `setInterval(checkBackendHealth, 5000)`).

**Measured impact** (Kokoro unloaded, before the fix):

```
health #1  4.60 s   kokoro_voices=54
health #2  3.18 s   kokoro_voices=54
health #3  3.63 s   kokoro_voices=54
```

A 5-second poll that costs 3-5 seconds of CPU never stops running on a dual-core i3.

**Fix** (`backend/app/services/kokoro_engine.py`): a new `_voice_ids()` helper reads the member names straight out of the `voices-v1.0.bin` archive and caches them, so building the model is no longer part of any read-only path. `list_voices()` and `validate_voice()` both use that cached list.

```
np.load(...).files        0.0048 s   (54 voices)
old list_voices()         5.80 s     (54 voices, identical result)
```

## 3. Defect 2 — `unload()` blocked on the synthesis lock (the "cannot switch back to Piper" bug)

**Symptom**: clicking Piper while Kokoro was synthesizing had no immediate effect; the switch hung until the Kokoro pass finished.

**Root cause**: `KokoroEngine.synthesize()` holds `self._lock` for the entire forward pass, and `unload()` did `with self._lock:` — while `EngineManager.select_engine()` held *its* manager lock. A switch therefore waited out the whole remaining Kokoro pass, and every Piper request queued behind that same manager lock.

**Fix** (`kokoro_engine.py` and `piper_engine.py`): unload is now non-blocking.

```python
acquired = self._lock.acquire(blocking=False)
if not acquired:
    self._unload_pending = True      # freed the instant the pass ends
    return
```

`synthesize()` honours the flag in a `finally:` block, so RAM is still released — just not by stalling the caller. `initialize()` calls `_release_model()` directly because it already holds the lock.

**Measured**: `select_engine('piper')` while the engine lock is deliberately held returns in **64.9 ms** (previously the whole remaining pass, 16-38 s).

## 4. Defect 3 — the prefetch code was dead

`readingStateMachine.ts` contained `prefetchBlock()`, `triggerPrefetchNext()` and a `prefetchBuffer`, but `triggerPrefetchNext()` had **zero call sites** and `processCurrentBlock()` never read the buffer. The feature was inert, and had it been enabled as written it would have leaked blob URLs (nothing revoked them) and double-synthesized blocks.

**Fix** — completed the implementation in `extension/src/sidepanel/state/readingStateMachine.ts`:

- `triggerPrefetchNext()` is now called once playback starts, and buffers only **one** block (`prefetchInFlight` and `size > 0` guards).
- `processCurrentBlock()` plays a buffered URL directly when present, otherwise synthesizes.
- Added `activeAudioUrl` tracking via `startAudio()` / `releaseActiveAudio()` so every object URL is revoked exactly once (on end, error, stop, switch, new content, or replacement).
- A result arriving after an engine change is discarded; the buffer is cleared on engine or speed change.

This removes the synthesis pause between paragraphs for Piper (~2 s per block on this hardware).

## 5. Post-Fix Measurements

Live backend (`run_server.py`), same machine, under moderate external load:

| Path | Before | After |
|---|---|---|
| `GET /api/v1/health` (Kokoro unloaded) | **3,180-4,600 ms** | **8 ms / 8 ms / 30 ms** |
| `POST /api/v1/engines/select` (idle) | 0.06 s | **74 ms** |
| `POST /api/v1/engines/select` (engine busy) | whole remaining pass | **under 1 s** (covered by test) |
| Kokoro cache hit | 0.19 s | **23 ms** |
| Kokoro cold (load + inference, 68 chars) | 58.46 s (idle, docs) | **99.32 s** (contended CPU) |
| Full pytest suite | 36.9-43.3 s | **19.0 s** |
| Automated tests | 15 | **18, all passing** |

> Kokoro inference remains the dominant cost and varies strongly with system load: the 99 s figure was measured while the CPU was ~60 % busy with Chrome and VS Code. The `performance_report.md` figure of **38.12 s warm** remains the reference on an idle machine. No thread-count change was made, because a controlled 4-thread versus 2-thread A/B could not be completed reliably under that contention.

## 6. New Regression Tests (`backend/tests/test_engines.py`)

- `test_health_check_never_loads_kokoro_model` — asserts `/health` answers with `_kokoro is None` and under 2 s.
- `test_voice_listing_never_loads_kokoro_model` — asserts `/voices?engine=kokoro` returns all voices without building a session.
- `test_engine_switch_does_not_block_on_busy_engine` — holds the engine lock for 10 s in a background thread, asserts the switch returns in under 1 s with the unload deferred, then asserts the deferred release still frees the model.

```
18 passed, 1 warning in 19.02s
```

## 7. Rebuild & Apply

```
cd extension
npm run build        # tsc && vite build -> dist/
```

Then in `chrome://extensions`, press **Reload** on *LocalVoice - Private Read Aloud*.

## 8. Known Limitations

- **Prefetch is type-checked and bundled but not browser-tested here** (no Chrome automation in this environment). Verify by reading a multi-paragraph page: transitions should be near-instant after the first block.
- **Kokoro remains unsuitable as a continuous reading engine** on this CPU; use Piper for long text.
- The `.npz` voice reader assumes `voices-v1.0.bin` stays a NumPy archive (it is, for Kokoro v1.0). A future voice pack format would need a new reader; today `list_voices()` logs and returns `[]` rather than raising.

