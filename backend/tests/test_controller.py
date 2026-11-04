"""
Tests for the supervisor's two honesty guarantees: a probe never raises, and one failed probe is
never reported as a dead engine.

The second one is not hypothetical. At 13:47:02 the log said the backend "went away without a stop
request" while `poll()` on the child this controller had spawned answered "still running" and the
next tick was healthy - a loopback blip reported as a death, on a machine where that message is the
only signal a user ever sees. These tests pin the two-tick rule so it cannot quietly regress.
"""

import socket

import controller


def _closed_port() -> int:
    """A port nothing is listening on: bound to get the number, then released."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _StubProc:
    def __init__(self, code: int | None) -> None:
        self._code = code

    def poll(self) -> int | None:
        return self._code


class _ScriptedShutdown:
    """Stands in for the Event: hands out the scripted `wait()` answers, one per tick."""

    def __init__(self, answers: list[bool]) -> None:
        self._answers = iter(answers)

    def wait(self, seconds: float) -> bool:
        return next(self._answers)


def _drive(monkeypatch, probes: list[tuple[bool, str]], ticks: list[bool]) -> list[str]:
    supervisor = controller.BackendSupervisor("http://127.0.0.1:1", 0, 5)  # idle stop off
    scripted = iter(probes)
    monkeypatch.setattr(supervisor, "probe", lambda timeout=1.0: next(scripted))
    supervisor._shutdown = _ScriptedShutdown(ticks)
    logged: list[str] = []
    monkeypatch.setattr(controller, "log", logged.append)
    supervisor.idle_loop()
    return logged


def test_probe_reports_a_failure_instead_of_raising():
    supervisor = controller.BackendSupervisor(f"http://127.0.0.1:{_closed_port()}", 300, 5)
    ok, reason = supervisor.probe(timeout=0.5)
    assert ok is False
    # A named reason, not an empty string: the log line is worthless without it.
    assert ":" in reason
    assert supervisor.is_up(timeout=0.5) is False


def test_exit_code_tells_a_crash_from_a_kill():
    supervisor = controller.BackendSupervisor("http://127.0.0.1:1", 300, 5)
    assert supervisor._exit_code() == "unknown, this controller did not spawn it"

    supervisor._proc = _StubProc(None)
    assert supervisor._exit_code() == "still running"

    supervisor._proc = _StubProc(-1073741819)  # 0xC0000005, an access violation
    assert "0xC0000005" in supervisor._exit_code()

    supervisor._proc = _StubProc(-1)  # TerminateProcess, i.e. taskkill
    assert "0xFFFFFFFF" in supervisor._exit_code()


def test_one_failed_probe_is_not_a_death(monkeypatch):
    logged = _drive(
        monkeypatch,
        probes=[(True, ""), (False, "TimeoutError: timed out"), (False, "TimeoutError"), (True, "")],
        ticks=[False, False, False, True],
    )
    assert logged == []


def test_two_failed_probes_are_a_death(monkeypatch):
    logged = _drive(
        monkeypatch,
        probes=[
            (True, ""),
            (False, "TimeoutError: timed out"),
            (False, "TimeoutError: timed out"),
            (False, "URLError: refused"),
            (False, "URLError: refused"),
        ],
        ticks=[False, False, False, True],
    )
    assert len(logged) == 1
    assert "went away without a stop request" in logged[0]
    assert "exit code" in logged[0]
