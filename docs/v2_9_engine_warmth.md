# V2.9 - Engines Stay Warm, and an Abandoned Request Stops Paying

## Symptom

The reader was paying model-load costs again and again, and the bill showed up as "Synthesizing":

- **Switching engine reloaded the model every time.** `select_engine()` called `unload()` on the
  engine being left, so Kokoro -> Piper -> Kokoro meant 8-24 s of Piper load, then 5-11 s of Kokoro
  session rebuild, for audio nobody had changed.
- **A cold start warmed the wrong engine and the wrong voice.** `initialize()` always warmed
  `settings.default_engine` with `settings.default_voice_id`, ignoring what the user actually
  reads with. A Kokoro user paid a Piper load first, then the Kokoro load.
- **Changing voice cost a full reload**, and the cost was indistinguishable from inference latency.
- **A paragraph the user had given up on kept the engine.** A closed popup, a language change or a
  panel switch left the in-flight `POST /synthesize` holding the engine lock for the whole
  paragraph, and the next (wanted) paragraph queued behind it.

## Root causes

1. `EngineManager.select_engine()` unloaded the outgoing engine eagerly, while holding the manager
   lock. Any model load was therefore serialised *and* paid twice per round trip; a busy engine
   could also block the switch itself.
2. Nothing remembered the last-used engine or the last-used voice per engine. `main.py`'s lifespan
   warmed the compile-time default, which is only correct on a first run.
3. The engine lock was acquired without any notion of the client having gone away. ONNX inference
   cannot be interrupted mid-pass, but it must not be *started* for a caller that already hung up.
4. Duplicate requests (two panels, a reopened popup) ran the same text through the engine twice,
   one behind the other on the same lock.

## The policy

| Concern | Decision |
| :--- | :--- |
| Residency | Both engines stay resident by default; an engine switch is a pointer flip. |
| Memory guard | The idle engine is released only when the process working set exceeds `max_resident_rss_mb` (default 1600 MB). |
| Persistence | `data/state.json` records `active_engine`, `last_used_engine` and `last_voice` per engine. Written atomically, best-effort: a read-only disk cannot fail a request. |
| Warm start | Startup loads the persisted engine (`last_used_engine`, else `active_engine`, else the default) unless `LOCALVOICE_WARM_START=0`. |
| Voice | The last voice used for an engine is warmed on load, so a restart does not silently change the reading voice. |
| Switching | `select_engine()` never loads a model and never blocks: it flips the pointer and, under the strict policy, defers the outgoing engine's release to the end of any in-flight pass. |
| Abandoned work | The API watches for client disconnect; the engine checks a `threading.Event` before starting a pass and while waiting for the lock, and raises `SynthesisAbandoned` -> HTTP 499. |
| Duplicates | `audio_cache.single_flight(key)` makes one request the owner and lets duplicates wait for that audio instead of queueing a second inference. |
| Reporting | `X-Engine-Load-Seconds` is sent apart from `X-Latency-Seconds`; `/api/v1/metrics` reports `resident_engines` and per-engine `is_loaded` / `load_seconds`. The old process-wide totals (`total_requests`, `average_latency_seconds`, `cache_stats`) stay at the top level, now summed over both engines, so the extension's diagnostics panel keeps working. |
| Client | The extension treats HTTP 499 as "already abandoned" and returns without entering the error state, and its diagnostics panel shows which models are in memory. |

## Files

| File | Change |
| :--- | :--- |
| `app/config.py` | `data_dir`, `state_file`, residency switches + env overrides. |
| `app/services/state_store.py` | Atomic JSON persistence of the active engine and per-engine last voice. |
| `app/services/cancellation.py` | `SynthesisAbandoned`, `is_cancelled()` and `acquire_lock()` (cancel-aware lock wait). |
| `app/services/audio_cache.py` | `claim` / `release` / `wait_for` / `single_flight`. |
| `app/services/engine_manager.py` | Persistence-aware warm selection, `resident_engines()`, `_release_idle_engines()`, `warm_startup_engine()`, non-blocking `select_engine()`, `get_metrics()`. |
| `app/services/piper_engine.py` | Persisted voice warm-up, `load_seconds`, cancel support, single-flight, deferred `unload()`. |
| `app/services/kokoro_engine.py` | Same contract for the Kokoro session. |
| `app/api/synthesis.py` | Disconnect watcher, `asyncio.to_thread` for the CPU-bound pass, 499 on abandon, load-time header. |
| `app/api/metrics.py` | Reports both engines plus residency instead of Piper only (keeps the panel's top-level totals). |
| `app/main.py` | Warm start on lifespan; `SynthesisAbandoned` handler; `X-Engine-Load-Seconds` exposed to CORS. |
| `extension/src/ui/state/readingStateMachine.ts` | Returns quietly on HTTP 499 instead of raising an error for work the user already abandoned. |
| `extension/src/ui/components/DiagnosticsModal.tsx` | Shows the models held in memory from `resident_engines`. |
| `extension/src/shared/types.ts` | Types `active_engine`, `resident_engines` and the per-engine metrics. |

## Switches

| Variable | Default | Effect |
| :--- | :--- | :--- |
| `LOCALVOICE_KEEP_WARM` | `1` | `0` restores strict one-model-at-a-time residency. |
| `LOCALVOICE_WARM_START` | `1` | `0` skips the startup load; the first request pays it instead. |
| `LOCALVOICE_STATE_FILE` | `backend/data/state.json` | Where the remembered engine/voice lives. |
| `LOCALVOICE_MAX_RSS_MB` | `1600` | Working set above which an idle engine may be released. |

## What to look for in the log

- `Loaded <engine> voice <id> in 8.73s` - a load that actually happened. With the warm policy this
  appears once per engine per process, not once per switch.
- `Piper unload deferred until the in-flight synthesis completes` - strict policy, busy engine; the
  switch still returned immediately.
- `Synthesized 47 chars via piper | voice=None | 10.027s (engine load 8.73s)` - a request whose cost
  was load, not inference. `voice=None` means the pass was served from the audio cache.
- `Abandoned synthesis request not started: engine=kokoro` - a client hung up before the pass began.

## Tests

`backend/tests/test_warmth.py` pins the new contract: state round-trip and corrupt-file tolerance,
`warm_engine_id()` preferring the last used engine, cancel-aware lock acquisition, the cancelled
synthesis that never reaches the engine, single-flight ownership/waiting/release-on-error, and the
`/api/v1/metrics` residency payload. `test_engines.py` pins the residency policy in both directions
(warm keeps the idle engine, `LOCALVOICE_KEEP_WARM=0` releases it without blocking), and
`test_synthesis.py` pins the 499 path and the load-time header.
