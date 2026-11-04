# V2.6 — The Action Popup, and a Read That Survives It

## Symptom

V2.5 moved the UI out of Chrome's side panel and into a `type: 'popup'` window: a real OS window,
fixed at 400 × 680, opened from the toolbar icon. It did not shrink the page, but it is the wrong
shape for a toolbar widget — it is a second application window for what is a dropdown, it cannot
be sized to its content, and closing it was the only way to dismiss it.

The requested surface is a normal toolbar action popup. That has one hard consequence, and V2.6 is
mostly about handling it.

## The surface

`extension/public/manifest.json`:

```json
"action": {
  "default_title": "LocalVoice - Read Aloud",
  "default_popup": "popup.html"
}
```

Chrome fits that dropdown to the document, so the document decides the size:

| Rule | Value | Why |
| :--- | :--- | :--- |
| `body` width | `max-content`, clamped `340px` … `520px` | Width follows the content (title, voice names, transport) instead of a hardcoded 400 px |
| Document height | unset | Chrome grows and shrinks the popup with the rows |
| `.panel-container` | `min-height: 240px` | Two rows of transport with nothing to read looks broken, not minimal |
| `.paragraph` | `max-height: 120px; overflow-y: auto` | Room for a normal paragraph, but one long block cannot resize the popup mid-read |
| `.panel-container[data-modal='open']` | `min-height: 540px` | Modals are `position: fixed`, so they contribute no document height |

That last row is the trap: a fixed-overlay modal is invisible to the box Chrome measures. Settings,
Diagnostics and Comparison would have been rendered inside a 240 px popup and clipped. `App.tsx`
sets `data-modal="open"` on the shell whenever one is open, so the document reserves the room
before the overlay is painted.

With `default_popup` set, `action.onClicked` never fires — Chrome opens the popup instead. The whole
window-management path therefore went away:

| Before | After |
| :--- | :--- |
| `chrome.action.onClicked` → `openUiWindow()` | removed; Chrome owns the surface |
| `chrome.windows.create({ type: 'popup', width: 400, height: 680 })` | removed |
| `chrome.windows.update(id, { focused: true })` + `windows.onRemoved` cleanup | removed |
| `UI_WINDOW_KEY` in `storage.session` | repurposed for the session snapshot |
| `OPEN_UI_WINDOW` message | removed |
| `body { width: 100%; min-width: 320px; }` | `width: max-content; min-width: 340px; max-width: 520px;` |
| `.modal-content { max-height: 85vh }` | `max-height: 100%` — viewport units in a popup this document sizes are circular |

## The constraint: a popup dies on the first click

Chrome closes an action popup as soon as it loses focus, and the popup document is destroyed with
it. The reading loop (`ReadingEngine`) lives in that document: it receives `AUDIO_ENDED`, advances
the index, requests the highlight and drives prefetch. So before V2.6, clicking into the article one
second after pressing Play ended the session — the current paragraph kept playing from the offscreen
document, and nothing ever advanced after it.

Moving the loop into the service worker would fix that and add a wake-up path, a state store and a
second copy of the `loadToken` bookkeeping. V2.6 keeps the loop where it is and persists *just
enough* to rebuild it:

| Piece | Where it lives | Why there |
| :--- | :--- | :--- |
| Blocks, index, tab id, page URL, engine, speed, `savedAt` | `chrome.storage.session` | Survives the popup, wiped with the browser session, never writes page text to disk |
| The `<audio>` element and `currentBlockId` | Offscreen document | Unaffected by the popup closing, so the current paragraph keeps playing |
| `GET_PLAYBACK_STATE` → `{ blockId, playing, hasSource, position, duration }` | Popup → offscreen | Lets a reopened popup distinguish "re-attached to live audio" from "bookmark" |

## Restore rules

`App.restoreSession()` runs on mount, after settings load, and only rebuilds the session if every
check passes:

| Check | Failure |
| :--- | :--- |
| `version === 1`, non-empty `blocks` | snapshot discarded silently |
| `0 ≤ now − savedAt ≤ 30 min` | discarded — an abandoned read is not a session |
| `chrome.tabs.get(tabId)` still resolves | discarded |
| `tab.url === snapshot.pageUrl` (when recorded) | discarded — a reused tab id must not resurrect another article |
| `snapshot.engine` / `playbackSpeed` match current settings | discarded — a different voice is a different read |
| Player holds the saved block (`hasSource` + matching `blockId`) | restore as **PLAYING**; `resumePrefetch()` refills the buffer |
| Otherwise | restore as **PAUSED** at the saved index |

Two details worth keeping:

- **A paused bookmark has no audio behind it.** The blob URL it played belonged to the destroyed
  document, so Play must not call `resume()` on an element with no source — that rejects and paints
  an error. `ReadingEngine.canResumeInPlace()` is the distinction; when it is false, Play calls
  `startReading(currentIndex)` and the backend answers from its disk cache in ~0.2 s.
- **The end of the paragraph is unknowable.** If the popup closed while PLAYING and the player no
  longer has a source, the paragraph finished with nobody listening for `ended`, so the restore
  starts at `min(index + 1, last)` instead of replaying it.

Writes are debounced (250 ms) because one paragraph hand-off passes through `SYNTHESIZING` and
`PLAYING` inside the same tick; the snapshot is dropped at 4 MB rather than failing a write on a
pathological page; and it is cleared on Stop, on COMPLETED and on `TAB_NAVIGATED`. A restore lands
with one dismissible line in the panel — `Resumed at 7 / 40 — press play to continue`, or
`Still reading 7 / 40 — reopened` when audio never stopped — because a half-filled player with no
explanation reads as a bug.

## Verify

```powershell
.\scripts\verify.ps1
```

Then reload the unpacked extension (`chrome://extensions` → LocalVoice → Reload — the manifest
changed) and check the surface:

1. Click the icon: a dropdown appears, not a window, and the empty state is small rather than a strip.
2. Read Page: the popup grows with the content and stays under 520 px wide.
3. Open Settings / Diagnostics / Comparison: none of them is clipped.
4. Play, then click into the page. The current paragraph finishes.
5. Reopen the popup: it shows `Resumed at N / M` (or `Still reading N / M — reopened` when that
   paragraph is still running) with the paragraph in place.
6. Press Play: audio continues from that paragraph.
7. Press Stop, reopen: the session is gone.

## Unchanged

No permission was added or widened: `storage` was already in the manifest, and `windows` was never
declared even in V2.5. `ENSURE_OFFSCREEN` and `TAB_NAVIGATED` still route through the service
worker, which is now smaller than it was before V2.5.
