# AGENTS.md

Working notes for anyone changing this repository — human or agent. Everything here is
verifiable from the code; nothing here is aspirational.

## What this is

A Chrome MV3 extension that reads a webpage aloud with **local** neural TTS.

The UI is its own 400×680 popup window, opened from the toolbar icon. Not the Chrome side
panel (it shrinks the page being read) and not an action popup (that closes the instant the
user clicks back into the article, and the reading loop lives in the UI, so the session
would die after the current paragraph).

```text
content script → background → popup window → offscreen document → FastAPI
extract blocks   route msgs   reading loop   one <audio> element  synth + cache
```

Piper (~0.2× RTF) is the daily driver. Kokoro (82M, ~8.7× RTF on a 2-core CPU) trades speed
for naturalness. Both run on CPU through ONNX Runtime; models are downloaded, never committed.

## Verify: one command

```powershell
.\scripts\verify.ps1        # extension typecheck + build, then backend pytest
```

That is the whole definition of "is this healthy". It runs both halves even for a
frontend-only change, because the panel's ETA numbers and error strings come from
`extension/src/shared/` modules that the backend suites also import.

First run on a fresh clone:

```powershell
.\scripts\setup.ps1         # venv + deps + default Piper voice + extension build
.\scripts\start.ps1         # backend on http://127.0.0.1:8765
# chrome://extensions → Developer mode → Load unpacked → extension\dist
```

## Invariants

Breaking one of these is a regression, not a preference.

1. **Speed is applied exactly once, in the backend.** `readingStateMachine.startAudio()`
   sends `speed: 1.0` on purpose: Piper's `length_scale` and Kokoro's `speed` already
   stretch the audio. Applying it again in the offscreen player made 1.25× play at 1.56×.
2. **One `<audio>` element, one owner.** The offscreen document owns it. A `play()` promise
   rejected because a newer load superseded it is *expected*; `loadToken` in
   `audio_player.ts` is what separates that from a real failure. Never surface it.
3. **Prefetch depth is a budget, not optimism**: 2 blocks for Piper, 1 for Kokoro, derived
   from `ENGINE_RTF`. An engine slower than real time cannot be prefetched out of a stall.
4. **Latency claims come from `enginePerf.ts`.** No literal "~15s" in JSX. If the estimate
   is wrong, fix the numbers there and every surface stays honest.
5. **Models never enter git**: `backend/voices/*.onnx` and `*.onnx.json` are ignored, and
   `extension/dist` is untracked on purpose. A 63 MB blob already had to be purged once.
6. **The backend listens on 127.0.0.1 only** and validates origins (`backend/app/utils/security.py`).

## UI contract

The panel shows **controls and facts**. It does not explain itself.

- No taglines, no helper sentences, no secondary labels. If a row needs a sentence to make
  sense, change the layout instead of adding the sentence.
- Numbers over prose: `42 para · 5 min`, `3 / 42`, `1:47/para · 34:12 total`.
- Silence is the healthy state. The status dot is wordless when the backend is up; the only
  rows that speak are the ones that need a decision (offline, engine too slow, an error).
- Empty states are the primary action itself, never instructions about the action.
- Explanation lives in `title=` tooltips; decisions live in visible text.
- One-off layout stays in the component. Anything reused (`.row`, `.spread`, `.chip`,
  `.banner`, `.segmented`, `.switch`, `.select`, `.paragraph`, `.meta`, `.section-label`)
  lives in `extension/src/styles/index.css` — do not re-invent it inline.

## Where to change what

| Concern | File |
| :--- | :--- |
| Reading loop, prefetch, pause/resume/next/prev | `extension/src/ui/state/readingStateMachine.ts` |
| Playback + AbortError classification | `extension/src/offscreen/audio_player.ts`, `shared/audioErrors.ts` |
| 4-tier page extraction, selection capture | `extension/src/content/extractor.ts` |
| Highlighting and auto-scroll | `extension/src/content/highlighter.ts` |
| Engine cost model / ETAs | `extension/src/shared/enginePerf.ts` |
| Window open/focus, offscreen lifecycle, message routing | `extension/src/background/index.ts` |
| Panel layout and copy | `extension/src/ui/components/` |
| Backend routes | `backend/app/api/` |
| Engines, LRU audio cache, voices | `backend/app/services/` |
| Defect write-ups | `docs/` (one file per fix, linked from the README changelog) |

## Definition of done

1. `.\scripts\verify.ps1` passes.
2. No new visible sentence in the panel unless it reports a failure or asks for a decision.
3. Behaviour changes get a short note in `docs/` and a line in the README changelog.
4. Commits use Conventional Commits: `fix(audio): …`, `feat(ui): …`, `chore(repo): …`,
   `docs: …`. One logical change per commit.
