# V2.2 — Playback hand-off stall ("Synthesizing Piper (Fast)…" between paragraphs)

**Reported symptom.** The reader plays the first one or two paragraphs, then every
subsequent paragraph transition shows `Synthesizing Piper (Fast)...` for several seconds
before the audio resumes.

**Impact.** Prefetch was effectively disabled after the first unlucky transition, so a
whole page was read at full synthesis latency instead of at buffered latency.

## Root cause

Two defects in `extension/src/sidepanel/state/readingStateMachine.ts` combined into a
permanent wedge.

### 1. A transition did not wait for the in-flight prefetch

When paragraph *N* finished, `processCurrentBlock()` only consulted `prefetchBuffer`. If
the prefetch for *N+1* was still on the wire — which happens whenever the audio of *N* is
shorter than the synthesis of *N+1* (short paragraphs, first miss after a cold start) — the
buffer was empty and the code fell through to step 3: `setState('SYNTHESIZING')` and a
**second POST of the same text**.

`app/services/piper_engine.py` serialises synthesis behind `self._lock`, so the duplicate
request queued behind the prefetch it was duplicating. The user waited the *remaining*
prefetch time **plus** a redundant round trip, with the "Synthesizing" badge as the only
feedback. Measured on this machine: Piper 4.5 s for a fresh block vs 21 ms from the audio
cache — the duplicate is pure waste.

### 2. The completed prefetch then wedged the buffer forever

The orphaned prefetch still finished and stored its blob URL under the block that had
already been played. `triggerPrefetchNext()` opened with

```ts
if (this.prefetchInFlight || this.prefetchBuffer.size > 0) return;
```

so from then on:

- the stale entry made `size > 0` true → the next block was **never prefetched**;
- every following transition re-ran defect 1 → another duplicate request and another
  stale entry.

That is why the problem appeared "after one or two paragraphs" and never recovered for the
rest of the page.

## Fix

- `prefetchInFlight` is now `{ seq, blockId, promise }` instead of a boolean, and
  `prefetchBlock()` returns that promise.
- `processCurrentBlock()` **awaits the prefetch for the block it needs** instead of issuing
  a duplicate request; it only synthesises itself if no request was running.
- `triggerPrefetchNext()` evicts (and revokes) buffered audio that is not for the next
  block, so a stale entry can no longer wedge the pipeline. It also aborts a prefetch for a
  block the user has navigated away from, and refuses to start a request when the reader is
  no longer in a reading state.
- Prefetch results are discarded if engine, speed or abort state changed while in flight.
- `startAudio()` re-asserts the offscreen document (`ENSURE_OFFSCREEN`) before every
  hand-off. The prefetched path previously skipped that step, so a reaped offscreen
  document could make `PLAY_AUDIO` reject.

Buffer depth stays at one block (~200 KB) — the constraint documented in the code.

## Verification

Not browser-verified in this session (no Chrome automation available). To confirm:

1. `npm run build` in `extension/`, reload the unpacked extension from `extension/dist`.
2. Open a long article with several short paragraphs, click **Read Page**.
3. Expected: paragraph 1 shows `Synthesizing` once; every later paragraph starts
   immediately. The badge should not reappear between paragraphs.
4. In the backend log, each paragraph text should be requested **once** — no duplicate POST
   pairs for the same text.
