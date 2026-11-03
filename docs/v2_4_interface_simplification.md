# V2.4 — Interface Pass

The panel had grown a second voice: it explained itself. Every state carried a sentence, a
label, or a tagline next to the control that already expressed it, and the first-run screen
was three paragraphs of instructions for two buttons.

This pass deletes the explanations and puts the meaning back into the layout.

## What changed

| Removed | Replaced by |
| :--- | :--- |
| `Dual TTS • 100% Local CPU` under the app name | Nothing. The two engine tabs and the status dot say it. |
| `⚡ Piper TTS (Fast)` / `✨ Kokoro (82M)` | `Piper` / `Kokoro`. Cost appears only when it actually matters (below). |
| `Ready` badge next to a green dot | The dot alone. Status speaks only when it is *Offline*. |
| `ACTIVE TAB` label, `N paragraphs extracted` | One row: page title + `42 para · 5 min`. |
| `PARAGRAPH 3 / 42` | `3 / 42`. |
| `Click "Read Page" or select text to read.` | Nothing. The two buttons are the empty state. |
| `Speed:` next to a select reading `1.25x` | The select. |
| `PIPER VOICE (1 available)` header and a `Test` button | One row: voice (as text when only one exists) + a preview icon. |
| Four-sentence Kokoro warning | `Kokoro · 1:47/para · 34:12 total` + `Piper 0:58` button on the same line. |
| `Backend not reachable at … Start it with …` | `Offline · 127.0.0.1:8765 · .\scripts\start.ps1`. |
| Settings sublabels and the privacy paragraph | Two switches and two buttons. The README states the privacy model once. |
| `WHICH VOICE DID YOU PREFER?`, `Evaluation Text:`, `Run Side-by-Side Benchmark` | `Preference`, a placeholder, `Run`. |

## Design primitives

`extension/src/styles/index.css` now owns the vocabulary instead of ~40 inline style
objects: `.row`, `.spread`, `.meta`, `.mono`, `.chip`, `.banner`, `.segmented`, `.switch`,
`.select`, `.field`, `.paragraph`, `.section-label`, `.divider`, plus `:focus-visible` rings
and the missing `.spin` keyframes (every spinner in the app was already using that class
with no rule behind it, so nothing had ever rotated).

## The rule

A panel row is a control or a fact. Explanation belongs in a `title=` tooltip. Silence is
the healthy state. If a row needs a sentence to make sense, the layout is wrong.

This is enforced socially rather than mechanically: see the UI contract in
[../AGENTS.md](../AGENTS.md) and use `.\scripts\verify.ps1` before committing.

## Unchanged

Reading behaviour, prefetch depth, speed handling and extraction are untouched — this pass
changes what the panel *says*, not what it *does*. `tsc && vite build` stays clean and the
backend suite is unaffected.
