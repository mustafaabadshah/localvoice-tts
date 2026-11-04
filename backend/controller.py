"""LocalVoice backend controller - the half of "auto-start" a browser cannot do.

Chrome gives an extension no API for launching a local process, so "click Read Page and it
just works" needs one long-lived helper living outside the browser. This module is that
helper: a dependency-free HTTP supervisor on 127.0.0.1:8766 that starts the uvicorn backend
on demand and shuts it down again once nothing has touched it for ``--idle-seconds``.

    POST /start    make sure the backend is up (waits for /api/v1/health), reset the idle timer
    POST /stop     terminate the backend, whether or not this process spawned it
    POST /touch    "still in use" - the extension sends this while audio plays
    GET  /status   what the popup's power button renders

It deliberately imports nothing from ``app.*``: the supervisor has to stay up while the
engine stack (and its ~600 MB of ONNX weights) is unloaded, and importing it just to ask
"are you alive?" would defeat the point.

Run it through ``scripts/controller.ps1``; the logon task that script registers is what makes
the whole thing invisible.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONTROLLER_VERSION = "1.0"
DEFAULT_CONTROLLER_PORT = 8766
DEFAULT_BACKEND_URL = "http://127.0.0.1:8765"
# 15 minutes of no request means "the user stopped using the extension", not "the user is
# reading a long article": playback itself keeps the timer alive (the offscreen player sends
# /touch), so this only counts genuine idleness.
DEFAULT_IDLE_SECONDS = 15 * 60
DEFAULT_START_TIMEOUT_SECONDS = 120

BACKEND_DIR = Path(__file__).resolve().parent
PID_FILE = BACKEND_DIR / "server.pid"
LOG_DIR = BACKEND_DIR / "logs"
CONTROLLER_LOG = LOG_DIR / "controller.log"
MAX_LOG_BYTES = 1_000_000


def log(message: str) -> None:
    """Never a silent failure: under pythonw.exe there is no console to print to."""
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [controller] {message}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        if CONTROLLER_LOG.exists() and CONTROLLER_LOG.stat().st_size > MAX_LOG_BYTES:
            CONTROLLER_LOG.replace(CONTROLLER_LOG.with_name("controller.log.1"))
        with CONTROLLER_LOG.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def backend_python() -> str:
    """The interpreter the engine stack lives in - not necessarily the one running us."""
    if os.name == "nt":
        candidate = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = BACKEND_DIR / ".venv" / "bin" / "python"
    return str(candidate) if candidate.exists() else sys.executable



class BackendSupervisor:
    """Owns the uvicorn child, the idle clock, and the honesty about both."""

    def __init__(self, backend_url: str, idle_seconds: int, start_timeout: int) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.idle_seconds = idle_seconds
        self.start_timeout = start_timeout
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._started_at: float | None = None
        self._last_activity = time.monotonic()
        self._shutdown = threading.Event()

    # ---------------------------------------------------------------- probes

    def is_up(self, timeout: float = 1.0) -> bool:
        try:
            with urllib.request.urlopen(f"{self.backend_url}/api/v1/health", timeout=timeout) as response:
                return 200 <= response.status < 300
        except (urllib.error.URLError, OSError, ValueError):
            return False

    def _pid_from_file(self) -> int | None:
        try:
            return int(PID_FILE.read_text().strip())
        except (OSError, ValueError):
            return None

    def _pid_alive(self, pid: int) -> bool:
        if os.name != "nt":
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return str(pid) in result.stdout
        except (OSError, subprocess.SubprocessError):
            return False

    def touch(self) -> None:
        self._last_activity = time.monotonic()

    # ---------------------------------------------------------------- status

    def status(self) -> dict:
        running = self.is_up(timeout=0.7)
        idle_for = time.monotonic() - self._last_activity
        remaining: int | None = None
        if running and self.idle_seconds > 0:
            remaining = max(0, int(self.idle_seconds - idle_for))
        return {
            "controller": "ok",
            "version": CONTROLLER_VERSION,
            "backend": "running" if running else "stopped",
            "pid": self._pid_from_file() if running else None,
            "backend_url": self.backend_url,
            "idle_seconds": self.idle_seconds,
            "idle_remaining_seconds": remaining,
            "uptime_seconds": (
                int(time.monotonic() - self._started_at) if self._started_at and running else None
            ),
        }

    # ---------------------------------------------------------------- start

    def start(self) -> dict:
        with self._lock:
            if self.is_up(timeout=1.0):
                self.touch()
                return self.status()

            log(f"starting backend with {backend_python()}")
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            # The same files start.ps1 writes, so "it never came up" is debuggable either way.
            out = (LOG_DIR / "server.out.log").open("ab", buffering=0)
            err = (LOG_DIR / "server.err.log").open("ab", buffering=0)
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            try:
                self._proc = subprocess.Popen(
                    [backend_python(), str(BACKEND_DIR / "run_server.py")],
                    cwd=str(BACKEND_DIR),
                    stdin=subprocess.DEVNULL,
                    stdout=out,
                    stderr=err,
                    env=env,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                )
            except OSError as exc:
                log(f"could not spawn the backend: {exc}")
                return {**self.status(), "backend": "failed", "error": str(exc)}

            began = time.monotonic()
            deadline = began + self.start_timeout
            while time.monotonic() < deadline:
                if self.is_up(timeout=0.5):
                    self.touch()
                    self._started_at = began
                    log(f"backend healthy after {time.monotonic() - began:.1f}s (pid {self._pid_from_file()})")
                    return self.status()
                # A trampoline interpreter (uv venv) can exit right after handing off to the
                # real one, so a dead Popen with a live PID file is not a failure. A dead
                # Popen that never wrote a PID file is.
                if self._proc.poll() is not None and not PID_FILE.exists():
                    log("backend exited during start-up - see logs/server.err.log")
                    return {**self.status(), "backend": "failed", "error": "backend exited during start-up"}
                time.sleep(0.25)

            log(f"backend still not healthy after {self.start_timeout}s")
            return {**self.status(), "backend": "starting", "error": "still warming up"}

    # ---------------------------------------------------------------- stop

    def _candidate_pids(self) -> list[int]:
        pids: list[int] = []
        if self._proc is not None and self._proc.poll() is None:
            pids.append(self._proc.pid)
        from_file = self._pid_from_file()
        if from_file and from_file not in pids:
            pids.append(from_file)
        return [pid for pid in pids if self._pid_alive(pid)]

    def _kill_tree(self, pid: int) -> None:
        try:
            if os.name == "nt":
                # /T matters: the venv python is a trampoline over the real interpreter, so
                # killing only the parent leaves the engine holding the port.
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
            else:
                os.kill(pid, 15)
        except (OSError, subprocess.SubprocessError) as exc:
            log(f"could not stop pid {pid}: {exc}")

    def _sweep(self) -> None:
        """Last resort for a backend this controller never spawned (start.ps1, a stray shell)."""
        if os.name != "nt":
            return
        command = (
            "Get-CimInstance Win32_Process | "
            "Where-Object { $_.CommandLine -like '*run_server.py*' } | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            log(f"sweep failed: {exc}")

    def stop(self, reason: str = "requested") -> dict:
        with self._lock:
            pids = self._candidate_pids()
            if not pids and not self.is_up(timeout=0.5):
                self._proc = None
                return self.status()

            for pid in pids:
                self._kill_tree(pid)

            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and self.is_up(timeout=0.5):
                time.sleep(0.25)

            if self.is_up(timeout=0.5):
                log("backend survived the kill - sweeping run_server.py processes")
                self._sweep()
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and self.is_up(timeout=0.5):
                    time.sleep(0.25)

            try:
                PID_FILE.unlink()
            except OSError:
                pass

            self._proc = None
            self._started_at = None
            log(f"backend stopped ({reason})")
            return self.status()

    # ---------------------------------------------------------------- idle

    def idle_loop(self) -> None:
        """
        One probe per tick: it decides "is it idle?" and, just as importantly, notices an engine
        that died on its own. A silent disappearance is the one failure mode this supervisor
        cannot otherwise report - the extension simply sees "stopped" and starts it again.
        """
        was_up = False
        while not self._shutdown.wait(5):
            up = self.is_up(timeout=0.5)
            if was_up and not up:
                log("backend went away without a stop request - the next read will restart it")
            was_up = up

            if self.idle_seconds <= 0:
                continue
            if time.monotonic() - self._last_activity < self.idle_seconds:
                continue
            if not up:
                # Nothing to stop: re-arm the clock instead of deciding "idle" forever.
                self.touch()
                continue
            log(f"idle for {self.idle_seconds}s - unloading the backend")
            self.stop(reason="idle")
            self.touch()
            was_up = False

    def shutdown(self) -> None:
        self._shutdown.set()



class ControllerHandler(BaseHTTPRequestHandler):
    supervisor: BackendSupervisor
    server_version = f"LocalVoiceController/{CONTROLLER_VERSION}"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002 - stdlib signature
        return  # the supervisor's own log is the one worth reading

    # -- plumbing ------------------------------------------------------

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        allowed = (
            origin.startswith("chrome-extension://")
            or origin.startswith("http://127.0.0.1")
            or origin.startswith("http://localhost")
        )
        if allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass  # the popup closed mid-response; that is not an error

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib naming
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._route()

    def do_POST(self) -> None:  # noqa: N802
        self._route()

    # -- routes --------------------------------------------------------

    def _route(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        supervisor = self.supervisor
        try:
            if path == "/status":
                supervisor.touch()
                self._send(supervisor.status())
            elif path == "/start":
                self._send(supervisor.start())
            elif path == "/stop":
                self._send(supervisor.stop())
            elif path == "/touch":
                supervisor.touch()
                self._send({"controller": "ok", "touched": True})
            elif path in ("/", "/health"):
                self._send({"controller": "ok", "version": CONTROLLER_VERSION})
            else:
                self._send({"error": "unknown route"}, status=404)
        except Exception as exc:  # noqa: BLE001 - a broken controller must not look like a dead port
            log(f"{path} failed: {exc}")
            self._send({"error": str(exc)}, status=500)


class ControllerServer(ThreadingHTTPServer):
    # Windows reads SO_REUSEADDR as "let anyone else bind this port too", so two controllers
    # can end up sharing 8766 - each with its own idle clock, one of them stopping the other's
    # backend with no log line in between. Refuse the second bind instead.
    allow_reuse_address = False
    daemon_threads = True


def probe_existing_controller(port: int, timeout: float = 1.5) -> str | None:
    """Summary line of a controller already serving this port, or None if the port is free."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - anything here just means "nothing useful is listening"
        return None
    return f"backend {data.get('backend')}, pid {data.get('pid')}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LocalVoice backend controller")
    parser.add_argument("--port", type=int, default=DEFAULT_CONTROLLER_PORT)
    parser.add_argument(
        "--idle-seconds",
        type=int,
        default=DEFAULT_IDLE_SECONDS,
        help="stop the backend after this long without a request (0 disables idle stop)",
    )
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL)
    parser.add_argument("--start-timeout", type=int, default=DEFAULT_START_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)

    existing = probe_existing_controller(args.port)
    if existing is not None:
        log(f"a controller is already serving 127.0.0.1:{args.port} ({existing}) - exiting")
        return 1

    supervisor = BackendSupervisor(args.backend_url, args.idle_seconds, args.start_timeout)
    handler = type("BoundControllerHandler", (ControllerHandler,), {"supervisor": supervisor})

    try:
        httpd = ControllerServer(("127.0.0.1", args.port), handler)
    except OSError as exc:
        log(f"port {args.port} unavailable ({exc}) - a controller is probably already running")
        return 1

    threading.Thread(target=supervisor.idle_loop, name="idle-watch", daemon=True).start()
    idle_label = "disabled" if args.idle_seconds <= 0 else f"{args.idle_seconds}s"
    log(
        f"listening on http://127.0.0.1:{args.port} "
        f"(backend {args.backend_url}, idle stop {idle_label})"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        supervisor.shutdown()
        httpd.server_close()
        log("controller stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
