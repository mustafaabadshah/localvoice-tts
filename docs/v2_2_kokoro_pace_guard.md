# V2.2 — "Synthesizing Kokoro (~15s)…" never ends: pace guard for engines slower than real time

**Reported symptom.** With **Kokoro** selected, the reader advances a few paragraphs and
then every remaining paragraph shows `Synthesizing Kokoro (~15s)...` for far longer than
15 seconds. The badge stays up so long it reads as a hang, and on a 94-paragraph article the
page never finishes.

## 1. What the numbers actually say

From `docs/performance_report.md` (measured on the reference machine — **Intel Core
i3-7100U, 2 physical cores / 4 threads, 2016 Kaby Lake, no AVX-512**):

| Engine | Audio produced | Warm synthesis time | RTF |
| :--- | :--- | :--- | :--- |
| Piper `lessac-medium` | 4.49 s | 2.06 s | **0.20x** (5x faster than real time) |
| Kokoro `af_heart` int8 | 4.40 s | 38.12 s | **8.66x** (8.7x *slower* than real time) |

RTF (real-time factor) is the whole story: synthesis seconds per second of audio.

* **Piper at RTF 0.20** — the next paragraph is always ready before the current one ends, so
  a single-block prefetch (documented buffer depth: one block, ~200 KB) makes every
  paragraph hand-off seamless. This is why Piper reads continuously.
* **Kokoro at RTF 8.66** — a paragraph that takes 25 s to speak needs ~3.6 minutes of CPU.
  No prefetch depth and no pipelining can hide that: the CPU is the floor, and every
  paragraph boundary *must* stall.

Live confirmation from the running backend (`GET /api/v1/metrics`, same session):

```
total_requests 33, average_latency_seconds 6.059      # Piper, full paragraphs
cache: 67 files / 22.68 MB, hit_rate_pct 64.62
```

Piper averages ~6 s per *entire paragraph* (~30 s of audio) — it keeps up comfortably.
Kokoro needs 43x more CPU for the same text, which is why a whole-page Kokoro read of a
21-minute article costs roughly **three hours** of synthesis.

## 2. Root cause of the perceived hang (three layered defects)

1. **Arithmetic (dominant):** Kokoro's RTF is 8.66 on this CPU, so continuous reading is
   physically impossible. The stall is not a scheduling bug — there is nothing to schedule.
2. **The label lied:** `PlaybackInfo.tsx` hard-coded `Synthesizing Kokoro (~15s)...`, so the
   user was told 15 s and then waited minutes with no way to tell progress from a freeze.
3. **The prefetch hand-off bug (fixed, see `v2_2_prefetch_handoff_fix.md`)** posted the same
   paragraph twice, serialising two passes on the engine lock. That *doubled* the wait and
   made a slow engine look like a wedged one.

## 3. What changed

* **New `extension/src/shared/enginePerf.ts`** — single source of truth for pacing:
  `ENGINE_RTF`, `CHARS_PER_AUDIO_SECOND` (19.8 for both en_US voices), and
  `estimateSynthSeconds` / `estimatePageSynthSeconds` / `formatDuration`.
* **Honest status label** (`PlaybackInfo.tsx`) — Kokoro now reports the real estimate for the
  paragraph currently in flight (`~38 s`, `~1.2 min`, `~3.6 min`), computed from the block's
  character count, instead of the fixed "~15s".
* **Pre-flight pace guard** (`App.tsx`) — as soon as a page is extracted while Kokoro is the
  active engine and the estimated cost exceeds one minute, a banner states the per-paragraph
  cost, the total cost for the page, and Piper's cost for the same page, with a one-click
  `⚡ Continue with Fast Piper`.
* **Engine switch now resumes** — `handleReadWithPiper()` switches engine *and* restarts at
  the paragraph being read. Previously the `⚡ Fast Piper` button stopped playback and dropped
  the user into a stopped player, which felt like another failure.
* Engine-per-request routing was already safe: `POST /api/v1/synthesize` honours
  `payload.engine` (falls back to `engine_manager.active_engine_id`), so resuming in Piper
  cannot race the `/engines/select` call.

## 4. Verification

1. `cd extension && npm run build` → `tsc && vite build` must exit 0.
2. Reload the unpacked extension from `extension/dist`.
3. Select **Kokoro** and read a long article:
   * banner appears immediately after extraction, quoting ~8.7x slower than playback and the
     total synthesis cost for that page;
   * the paragraph badge shows a *minutes-scale* estimate, never a fake `~15s`.
4. Click `⚡ Continue with Fast Piper`: audio resumes **at the current paragraph** in Piper and
   subsequent paragraphs start instantly (prefetch fix + RTF 0.20).
5. Watch the backend log: Piper reading should show one `POST /api/v1/synthesize` per
   paragraph text, no duplicate pairs.

## 5. Standing guidance

On ≤4-thread CPUs **Piper is the reading engine**; Kokoro is for short selections, voice
auditions, and the comparison modal, where a 38 s wait for a sentence or two is acceptable.
The pace guard exists so this trade-off is visible *before* minutes of CPU are spent, rather
than buried in a status badge.
