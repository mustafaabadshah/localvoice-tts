# V2.8 - Read Page Continues, and Audio Is Never Synthesised Twice

## Symptom

Two presses that should have been free were paid for in full, every time:

- **Read Page always restarted at paragraph 1.** Pause at paragraph 12, close the popup, reopen it,
  press the primary button: the page was re-extracted, `setContent()` reset the position to 0, and
  the reader began again at the top. The button was also the way back from an engine switch, so
  every Kokoro -> Piper -> Kokoro round trip meant watching "Synthesizing..." for a paragraph the
  user had already heard.
- **Switching engine re-synthesised everything.** Kokoro on a 2-core CPU runs at ~8.7x RTF, so
  re-reading a paragraph cost ~40 s of engine time for audio that already existed - once per
  switch, in both directions.

## Root causes

1. `handleReadPage` in `App.tsx` called `setContent(...)` then `startReading(0)`
   unconditionally. `setContent()` is the *new document* entry point: it clears the buffer and
   sets `currentIndex = 0`. Only two things may reset the position - Stop, and a genuinely
   different page - and neither was checked.
2. `Controls` had one label ("Read Page") for a control that means two different things
   depending on whether a session is live.
3. `updateSettings` invalidated buffered audio for an engine change and a speed change, but not
   for a **voice** change: the same text in a different voice is a different audio file, so the
   buffer and the loaded blob kept speaking the previous voice.
4. Nothing cached audio on the client. The backend's `audio_cache` was already keyed correctly
   (`engine|text|voice|speed|model_fingerprint`) and served 1 ms hits, but a hit still meant a
   POST, a JSON round trip and the whole payload, and it disappeared with the engine process.
   Every popup close and every engine switch threw the audio away and asked for it again.

## The rule that now holds

> **Stop is the only reset to paragraph 1.** "Read Page" continues the current document; it
> re-extracts only when the tab moved to another URL, when there are no blocks, or when the last
> read ran to `COMPLETED`. A selection is always fresh.

Implemented as an identity check in `handleReadPage`: same tab id + same URL (hash stripped) +
the session states that mean "still reading" (`READY`, `PAUSED`, `PLAYING`, `SYNTHESIZING`,
`IDLE`). `COMPLETED` and `ERROR` deliberately fail it, so a finished or broken read starts clean.
When the check passes, the handler speaks `currentIndex` and shows a dismissible
`Continuing at paragraph N of M`; the primary button reads **Continue** (`continueAt` prop),
with the paragraph number in its tooltip.

## The clip store

`extension/src/shared/audioClips.ts` - IndexedDB, database `localvoice-audio`, one object store.

| Concern | Decision |
| :--- | :--- |
| Key | `SHA-256(engine \| voiceId \| speed \| text)`. Nothing else changes the bytes. |
| Value | the audio `Blob` plus `bytes`, `lastUsed`, engine, voice - so the store can be audited. |
| Bound | 120 MB, LRU-trimmed on write by `lastUsed`. |
| Failure mode | every operation returns "miss" instead of throwing. A broken cache must never break playback. |
| Scope | the extension origin, shared by popup and service worker, so it survives popup teardown. |

`manifest.json` gained `unlimitedStorage` (no new host permission, no install prompt) so Chrome
cannot evict the store under disk pressure.

Read order in `processCurrentBlock` is now **buffer -> clip store -> network**:

1. `prefetchBuffer` (this popup already had the blob URL) - unchanged, still instant.
2. the in-flight prefetch for *this* block is awaited instead of duplicated - unchanged.
3. `getClip()` - plays immediately with no request at all.
4. `POST /api/v1/synthesize`, then `putClip()` so the next switch, reopen or replay is a hit.

`prefetchBlock` consults the store before synthesising too, which is what makes a Kokoro -> Piper
switch at paragraph 12 speak as soon as the button is pressed, and `prepareCurrent()` (called by
`handleSelectEngine`) warms that paragraph while the popup sits idle.

`warmStart()` now takes an index and defaults to `currentIndex`; it used to always warm block 0,
which was useless after a resume. `sessionToken` was added so an await that outlives a Stop or an
engine switch drops its result instead of starting audio the user no longer wants.

Settings' "Clear cache" clears both halves - `POST /api/v1/cache/clear` and `clearClips()`.

## Verification

`.\\scripts\\verify.ps1`: extension typecheck + build clean, backend 22 tests pass.

Manual pass in Chrome: read five paragraphs with Piper, switch to Kokoro, press **Continue**
(paragraph 6, instant from the clip store), switch back to Piper, press **Continue** again - no
new lines in `backend/logs/` while the backend still answers `/api/v1/cache/stats`, i.e. the
engine was never asked for that text again.

## Behaviour changes to expect

- After Stop, the position really is paragraph 1 - Stop is the reset.
- After the last paragraph, the primary button is **Read Page** again and re-extracts.
- A speed change still applies from the next paragraph; audio already cached for the old speed is
  simply never used again (the key changes).
- A voice change re-speaks the current paragraph in the new voice, immediately.
