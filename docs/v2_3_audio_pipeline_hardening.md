# V2.3 — Audio pipeline hardening + end-to-end workflow review

**Reported symptoms.**

1. With **Kokoro** selected, around the **5th–6th paragraph** the reader dies with
   `Audio playback error: The play() request was interrupted by a new load request.`
2. **Piper** "can improve much" — pacing and quality are worse than the engine is capable of.

Both turned out to be real defects, not engine limits. This document records the root causes,
the fixes, and the resulting end-to-end map of the reading pipeline with the remaining backlog.

---

## 1. `play() request was interrupted by a new load request` — a cancellation was reported as a fatal error

### What actually happens in Chrome

`HTMLMediaElement.play()` returns a promise that settles once playback *starts*. If the element
is given a different `src`, paused, or torn down before that happens, the promise is **rejected
with `AbortError`** and the message `The play() request was interrupted by a new load request.`

That is exactly what this player does on every paragraph hand-off — there is a single
`<audio>` element in the offscreen document and each block replaces its source:

```
handleAudioEnded()            -> nextParagraph()
  sendMessage(STOP_AUDIO)     -> audioEl.pause(); removeAttribute('src'); load()   <-- rejects play()
  processCurrentBlock()       -> sendMessage(PLAY_AUDIO)  -> audioEl.src = <next blob>; play()
```

`Stop` and the new `src` both land inside the window where the *previous* `play()` has not
settled yet, so the pending promise rejects. The offscreen player forwarded the rejection
verbatim as `AUDIO_ERROR`, and `handleAudioError()` treated it like a decode failure: it dropped
the prefetch buffer, stopped the engine and put the panel into `ERROR`. One expected cancellation
ended the whole read.

It surfaced at paragraph 5–6 rather than immediately because it needs a hand-off to happen while
a `play()` is still pending, and Kokoro's much longer synthesis time widens that window (the user
also presses pause/next while waiting, and `pause()` on a pending `play()` produces the sibling
message *"interrupted by a call to pause"*).

### Fix — classify the cancellation instead of surfacing it

New shared module `extension/src/shared/audioErrors.ts`:

- `isSupersededPlaybackError(error)` — true for `name === 'AbortError'` and for the
  "interrupted by a new load request / call to pause / call to load / user agent" messages.
- `describeAudioError(error)` — safe message extraction from `Error`, `DOMException`, string.

Used in three places:

| Location | Change |
| --- | --- |
| `offscreen/audio_player.ts` | `loadToken` is bumped on every load and teardown; a rejected `play()` is ignored when its token is stale, and `reportAudioError()` drops superseded playback errors. The `error` listener now ignores events with no `currentSrc` (the `removeAttribute('src') + load()` teardown fires one). |
| `sidepanel/state/readingStateMachine.ts` | `handleAudioError(error, blockId)` ignores superseded playback errors **and** errors attributed to a block that is no longer current (they cannot affect what is playing). |
| `types.ts` / message routing | `AUDIO_ERROR.blockId` is now actually used for that check. |

A genuine failure still lands in `ERROR`, but the session is no longer killed by the ordinary
paragraph transition.

---

## 2. Piper speed was applied twice

The backend already bakes the speed multiplier into the audio it produces:

- `piper_engine.py`: `length_scale = 1.0 / effective_speed`
- `kokoro_engine.py`: `speed` is passed to the Kokoro pipeline

The side panel *also* sent the same multiplier to the offscreen player, which set
`audioEl.playbackRate = speed`. Selecting **1.25x** therefore played **1.56x** audio (1.5x →
2.25x, 2.0x → 4.0x). That is the "Piper sounds rushed and artifacty when sped up" report: the
audio was already time-compressed by the model and then compressed again by the resampler.

**Fix.** `startAudio()` now always sends `speed: 1.0` — the multiplier belongs to synthesis.
A speed change still invalidates the prefetch buffer (buffered audio exists only for the old
speed) but no longer sends `SET_AUDIO_SPEED`, so the block already playing finishes at the pace
it was synthesised at and the next one picks up the new value. The handler remains in the player,
documented, for a future "rate only" control.

---

## 3. Piper experience improvements

| Change | Why |
| --- | --- |
| **Warm start** — `setContent()` pre-synthesises the opening block(s) while the panel sits in `READY` | Pressing Play used to wait out a full synthesis pass (~6 s for a typical paragraph) staring at "Ready". If the opening block is a heading (<120 chars) the first real paragraph is queued behind it, because the heading is over in about a second. **Piper only**: a Kokoro warm-up would hold the engine lock for ~40 s and stall an engine switch or the "Continue with Fast Piper" fallback. |
| **Prefetch depth 2 for Piper** (`prefetchDepth`), 1 for Kokoro | At RTF 0.20 two blocks of look-ahead cost a fraction of one paragraph's playback and absorb an unusually long block; Kokoro at RTF 8.66+ only gains latency from a queued second request. The buffer is a `Map`, so this needed no new state — only the pruning rule (keep everything in `currentIndex + 1 .. + depth`). |
| **Refill after a fill** | `prefetchBlock()` chains into `triggerPrefetchNext()` once more *only when the request actually produced audio*, so the second slot gets filled without risking an unbounded retry loop for a failing block. |
| **Honest Piper ETA** | `Synthesizing Piper (Fast)...` → `Synthesizing Piper (~6.3 s)...`, from `enginePerf.estimateSynthSeconds('piper', text)`, matching the Kokoro badge. |
| **`COMPLETED` instead of a silent reset** | `nextParagraph()` called `stop()` at the last block, which zeroed `currentIndex` and reported `IDLE`. `finish()` keeps the position, clears highlights, releases audio and sets `COMPLETED`, so Play resumes at the last paragraph. |
| **Play recovers from `ERROR`** | `handlePlayPause()` did nothing in `ERROR` — a dead end. It now retries from `currentIndex` like `READY`/`COMPLETED`. |

Piper text handling was reviewed and left alone: `validate_and_normalize_text()` only strips and
length-checks, it never rewrites or lowercases text, so nothing there degrades prosody. The
remaining quality ceiling is the single installed model (`en_US-lessac-medium`); adding voices is
a model-download task, not a code change.

---

## 4. End-to-end pipeline (after v2.3)

```
[content script]                    [background SW]        [side panel]                    [offscreen]                [backend]
 extract(tab)  ───────────────────► messageRouter ───────► blocks[] / setContent()
                    4-tier DOM extraction                  ├─ warmStart() ────────────────► POST /synthesize (block 0,1) ──► engine lock
                                                           └─ state READY
 user presses Play ───────────────────────────────────────► processCurrentBlock()
                                                             ├─ highlight block in tab
                                                             ├─ buffer hit? ───────────────► PLAY_AUDIO ──► <audio>.src = blob
                                                             ├─ prefetch in flight for this
                                                             │  block? await it (no dup POST)
                                                             └─ else POST /synthesize (1 POST/block) ──► cache hit (~0.2 s)
                                                                                                        or Piper ~6 s / Kokoro 38 s+
 <audio> 'ended' ────────────────────────────────────────── handleAudioEnded() ──► nextParagraph()
                                                             ├─ STOP_AUDIO (abort tolerated now)
                                                             ├─ releaseActiveAudio() (revoke blob)
                                                             └─ processCurrentBlock()  → loop
 end of blocks ──────────────────────────────────────────── finish(): COMPLETED, position kept
```

Latency budget per paragraph on the reference machine (i3-7100U):

| Stage | Piper | Kokoro |
| --- | --- | --- |
| Extraction (whole page, once) | 0.6–2 s | same |
| Synthesis per ~30 s paragraph | ~6 s | ~260 s |
| Hidden by prefetch? | yes — RTF 0.20 | no — RTF 8.66+ |
| Disk-cache hit | ~0.2 s | ~0.2 s |
| Blob hand-off (`PLAY_AUDIO` round-trip) | 30–90 ms | same |
| **User-perceived gap between paragraphs** | **≈0 ms (buffered)** | **minutes** |

The Kokoro column is arithmetic, not a bug; `docs/v2_2_kokoro_pace_guard.md` covers why and what
the UI now says about it.

---

## 5. Remaining backlog (not done here, in value order)

1. **Sentence-level streaming** — synthesise sentence 1 of each block first and play it while the
   rest renders. Cuts Piper's first-word latency from ~6 s to ~1 s and would make Kokoro *usable*
   (per-sentence stalls instead of per-paragraph ones). Needs a chunk queue in the state machine
   and sentence-split audio joining.
2. **Two `<audio>` elements with a crossfade hand-off** — removes the 30–90 ms `PLAY_AUDIO`
   round-trip. Only worth it after (1).
3. **More Piper voices** — `en_US-amy-medium` / `en_US-ryan-high` are a download plus a voice
   manifest entry, no engine work; the single installed voice is today's quality ceiling.
4. **DirectML / GPU execution provider for Kokoro** — the only way to get Kokoro faster than real
   time on this class of machine.
5. **Windows autostart for the backend** — today the panel shows a connection error until the
   user starts it by hand.
6. **Re-measure Kokoro RTF** — live probes showed 18–30x under load versus the 8.66x in
   `docs/performance_report.md`; the UI uses the conservative 8.66x.

---

## 6. Verification

```powershell
cd "e:\MM Office\Model infrince tts\LocalVoice\extension"
npm run build          # tsc + vite build, expect exit 0
```

Then reload the unpacked extension from `extension/dist` and check:

- **Kokoro, read 8+ paragraphs** — no `play()` abort message; the panel stays in
  `PLAYING`/`SYNTHESIZING` for the whole page.
- **Pause or Next while "Synthesizing Kokoro"** — no error banner.
- **Piper at 1.25x** — audibly 1.25x, not 1.56x; the voice no longer sounds rushed.
- **Piper, Play on a fresh page** — speech starts immediately (warm start), no badge.
- **Piper, read to the end** — panel shows `Completed`, Play resumes at the last paragraph.
- **Backend log** — one `POST /api/v1/synthesize` per paragraph (no duplicates).


