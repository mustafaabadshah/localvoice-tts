# V2.5 — The Popup Surface

> **Superseded by [V2.6](v2_6_action_popup.md).** The UI is now a plain `action.default_popup`:
> Chrome sizes the dropdown to the document and `windows.create` is gone. The reasoning below is
> kept because it is the reason the session-resume layer exists — a `type: 'popup'` window was
> chosen to keep the reading loop alive, and V2.6 solves that problem with a snapshot instead of
> with a surface.

## Symptom

The UI was a Chrome **side panel**: every launch docked a pane to the right edge of the browser
window and shrank the page underneath it. Reading a long article meant giving up a third of the
screen for a widget that is idle most of the time, and the page reflowed as soon as the panel
opened.

## Why not simply use `action.default_popup`

An action popup is the smallest change — one manifest key — and it is the wrong surface here:

| | Action popup (`default_popup`) | Separate window (`windows.create`, `type: 'popup'`) |
| :--- | :--- | :--- |
| Closes when you click the page | **yes** — on blur | no |
| Reading loop keeps running | **no**: the loop lives in the UI, so the session ends after the current paragraph | yes |
| Shrinks the page | no | no |
| Survives tab switches | no | yes |

The reading loop (`ReadingEngine`) is what receives `AUDIO_ENDED`, synthesises or prefetches the
next block, advances the highlight and requests scroll. It runs in the UI page, not in the service
worker, because the offscreen document only *plays* audio it is handed. Any surface that closes on
blur therefore ends a session the moment the user clicks back into the article — which is the
normal thing to do one second after pressing Read. Moving the loop into the MV3 service worker
would fix that and add a state-persistence layer, a wake-up path and a second copy of the
`loadToken` bookkeeping; the wrong trade for a UI complaint.

A `type: 'popup'` window is a real window: no tab strip, no address bar, no docking, and it stays
open while the user reads, scrolls, clicks and switches tabs beneath it.

## What changed

| Before | After |
| :--- | :--- |
| `"side_panel": { "default_path": "sidepanel.html" }` + `sidePanel` permission | removed; nothing docked to the page any more |
| `setPanelBehavior({ openPanelOnActionClick: true })` | `action.onClicked` → open or focus the UI window |
| `sidepanel.html` | `popup.html` (400 × 680, `type: 'popup'`) |
| Header "Dock to Side Panel" button | removed — the UI is already a window |
| `OPEN_SIDE_PANEL` message | `OPEN_UI_WINDOW` (same intent, new surface) |
| `extension/src/sidepanel/` | `extension/src/ui/` |
| `body { max-width: 480px; margin: 0 auto; }` | full viewport width; a window is resizable, a panel is not |

## Behaviour

- Toolbar icon: opens the window, or focuses the one already open. The window id is kept in
  `chrome.storage.session` and dropped on `windows.onRemoved`, so a closed window never shadows
  the next launch, and a service worker restart never stacks a second copy.
- Window closed: the session ends. That is now a deliberate act instead of an accidental one.
- No permission was added and none was widened; `windows` needs no permission and `storage` was
  already in the manifest. `sidePanel` is gone, so the install prompt got narrower, not wider.

## Verify

```powershell
.\scripts\verify.ps1
```

Then reload the unpacked extension (`chrome://extensions` → LocalVoice → Reload) — the manifest
changed — and click the toolbar icon: the UI must appear as its own window, and a second click must
focus that window rather than open another.
