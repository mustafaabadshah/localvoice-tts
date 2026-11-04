# V2.7 — The Backend Starts Itself, and Stops Itself

## Symptom

Every session started with a manual step that had nothing to do with reading:

```powershell
.\scripts\start.ps1      # in some terminal, before touching the extension
```

The reasons that is wrong outnumber the reasons it is right. The backend keeps ~600 MB of ONNX
weights resident for as long as it runs, and it ran forever; there was no path from "I opened the
popup" to "the engine is up"; and the only feedback when it was down was a red `Offline` row telling
the user to go run a script. The request was: open the extension, click Read Page, and have it work
— with one button to turn the engine on and off, and an automatic stop when the extension has not
been used for a while.

## Why a browser cannot do this alone

Chrome MV3 gives extensions no API for launching a local process. `nativeMessaging` requires a
registry-installed host that the same manual step would have to install, and it cannot be started by
the extension either. So "start the backend on demand" needs exactly one long-lived helper outside
the browser, and the least surprising one is a tiny local server the extension can already talk to.

## The controller

`backend/controller.py` — ~400 lines, standard library only, nothing from `app.*` imported. The
supervisor must stay alive while the engine stack is unloaded; importing it to ask "are you alive?"
would defeat the point.

| Route | Method | Effect |
| :--- | :--- | :--- |
| `/start` | POST | Spawn `run_server.py` with the venv interpreter, poll `/api/v1/health` until healthy, reset the idle clock |
| `/stop` | POST | `taskkill /T /F` the PID from `server.pid` (plus its own child), sweep `run_server.py` as a fallback |
| `/touch` | POST | "still in use" — reset the idle clock |
| `/status` | GET | `{backend, pid, idle_seconds, idle_remaining_seconds, …}` |
| `/health` | GET | controller identity, no side effects |

It listens on `127.0.0.1:8766`, never on a public interface, and mirrors the backend's own CORS rule:
a response is only given an `Allow-Origin` header when the caller is `chrome-extension://…` or a
loopback page, so a random website cannot switch the engine on.

Two details are load-bearing on Windows:

- **`/T` on the kill.** The venv `python.exe` is a trampoline over the real interpreter. Killing only
  the parent leaves the engine holding port 8765, and the next start then fails on bind.
- **Start-up waits on `/api/v1/health`, not on the process.** The first Piper load takes 11–15 s on
  this class of box (measured, see below). `/start` blocks until the engine answers, so the extension
  gets "running" or a real failure, never a race it has to retry.

The idle loop wakes every 5 s (`--idle-seconds`, default `900`) and takes a single health probe per
tick. That probe decides two things: whether the idle window has expired, and whether something that
was up has gone away on its own — which it logs, because an engine that dies without a stop request is
otherwise indistinguishable from one the user turned off:

```
[controller] backend went away without a stop request - the next read will restart it
```

- **One controller per port, enforced twice.** `main()` first asks `/status` on its own port and exits
  with `a controller is already serving 127.0.0.1:8766 (backend running, pid 8704) - exiting` if the
  answer comes back, then binds with `allow_reuse_address = False`. The second half matters on
  Windows, where `SO_REUSEADDR` means "let anyone bind this port too": two controllers would share
  8766 with separate idle clocks, and one of them (a leftover from a test with a short window) would
  eventually `taskkill` the other's backend with nothing in the log to explain it. Verified: a
  duplicate exits in under a second and the running backend keeps its PID.

## Installation

`scripts/controller.ps1` registers it as a per-user logon task via `Register-ScheduledTask` (no
elevation required): `pythonw.exe` with `--port 8766 --idle-seconds <n>`, `-RestartCount 3`,
`-ExecutionTimeLimit 0`, `-MultipleInstances IgnoreNew`.

```powershell
.\scripts\controller.ps1                 # install + start, auto-off after 15 min
.\scripts\controller.ps1 -IdleMinutes 30 # reinstall with another window
.\scripts\controller.ps1 -IdleMinutes 0  # never auto-stop
.\scripts\controller.ps1 -Action status  # what the controller sees right now
.\scripts\controller.ps1 -Action uninstall
```

The task argument quotes the script path explicitly. `New-ScheduledTaskAction -Argument` hands its
string to `CreateProcess` verbatim, and this repository lives under `E:\MM Office\…` — unquoted, the
task starts python with `E:\MM` and dies instantly, which is exactly the failure mode `start.ps1`
documents for `Start-Process`.

`-Action uninstall` restores the old workflow; nothing in the extension breaks, it just reports
`Offline` again.

## The extension side

| Piece | File | Behaviour |
| :--- | :--- | :--- |
| Client + timeouts | `extension/src/shared/backendControl.ts` | `readControllerStatus` / `startBackend` / `stopBackend` / `touchBackendActivity`; every one returns `null` instead of throwing when no controller is installed |
| Wake on failure | `ui/state/readingStateMachine.ts` → `synthesize()` | A `Failed to fetch` on `/api/v1/synthesize` triggers one `/start` and one retry — never on `AbortError`, and only once per failure |
| Shared warm-up | `readingStateMachine.ts` → `wakeBackend()` | One in-flight `/start` promise, because the main request and the prefetcher fail together on a cold popup |
| Keep-alive | `offscreen/audio_player.ts` | `/touch` every 60 s while audio runs, from PLAY to `ended`/STOP |
| Power row | `ui/components/BackendPower.tsx` | `Backend on · 127.0.0.1:8765 · auto-off 15 min · ⏻` |
| Popup wiring | `ui/App.tsx` | `/status` polled with the existing 5 s health poll; the power button calls `/start` or `/stop` |

The keep-alive is the part that is easy to get wrong. Idle is measured by the controller, and by the
time a chapter is half-read the popup that started it has been closed for minutes — a naive "stop
after 15 min without extension activity" would unload the engine mid-chapter. The heartbeat comes
from the offscreen document, which is also where the audio lives, so it stops exactly when playback
does. Pausing does not stop it: a paused read is still a read the user intends to continue.

Turning the backend off from the popup clears the voice list, because that list describes a process
that is no longer running.

## Measured on this machine

| Step | Result |
| :--- | :--- |
| `/start` from cold, Piper Lessac | `backend healthy after 11.6 s` … `24.4 s` (warm file cache vs. cold) |
| `/stop` while playing nothing | backend's `/api/v1/health` unreachable within ~1 s, port released |
| Idle stop, `--idle-seconds 8` | backend gone at `+15 s`, logged `idle for 8s - unloading the backend` |
| `--idle-seconds 900` (default) | `idle_remaining_seconds: 899` immediately after boot |
| Untouched for 5 min at `--idle-seconds 900` | still `backend=running` at `+300 s` (no idle stop, no probe noise) |
| Second controller on the same port | exits `< 1 s`, logs `a controller is already serving … - exiting`, backend PID unchanged |
| `/start` from the logon-task instance (`pythonw.exe`, no console) | identical behaviour, 24.4 s cold |

That 11–25 s spread is why `/start` waits on `/api/v1/health` instead of a fixed sleep, and why the
popup shows `Backend warm-up` rather than a spinner: the number is real, it is just not constant.

## Limits

- **The controller is opt-in.** A clone that never runs `scripts/controller.ps1` behaves exactly as
  before; the power row then names the script instead of offering a button.
- **Windows Task Scheduler is the scheduler.** On another OS, run `controller.py` under whatever
  supervises services there; the HTTP contract is unchanged.
- **One backend per machine.** The controller supervises `127.0.0.1:8765`; a manually started
  backend on the same port is adopted, not duplicated.
- **One controller per port.** A second instance refuses to start rather than sharing 8766, so
  `-Action status` is the way to ask the logon-task instance what it is doing.
- **`start.ps1` still works.** It is now the manual escape hatch rather than the normal path; if both
  are used, the controller adopts whatever is already listening.

