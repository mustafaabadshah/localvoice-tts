"""
Cooperative cancellation for synthesis requests.

ONNX Runtime cannot be interrupted mid-inference, so this is deliberately weaker than "cancel":
a request that has *not started yet* must not start, and a request waiting for a busy engine must
give up instead of queueing behind work nobody is waiting for.

That is the part that actually hurt. A language change aborts the fetch on the client, but the
worker thread kept synthesising the abandoned paragraph while holding the engine lock - at
Kokoro's ~8.7x real time on this class of hardware that is tens of seconds - so the paragraph the
user actually wanted waited for one they had already given up on. See docs/v2_9_engine_warmth.md.
"""

import threading
import time

from app.config import settings


class SynthesisAbandoned(Exception):
    """The client hung up (or gave up waiting) before this request could start."""


def is_cancelled(cancel: threading.Event | None) -> bool:
    return cancel is not None and cancel.is_set()


def acquire_lock(
    lock: threading.Lock,
    cancel: threading.Event | None = None,
    timeout: float | None = None,
) -> bool:
    """
    Acquires ``lock``, giving up as soon as ``cancel`` is set.

    Returns True when the caller holds the lock and must release it, False when the wait timed
    out or the request was abandoned. With no cancel event this is a plain timed acquire, so the
    engines keep working for callers that never pass one (comparison benchmarks, tests).
    """
    timeout = settings.lock_wait_seconds if timeout is None else timeout

    if cancel is None:
        return lock.acquire(timeout=timeout)

    deadline = time.monotonic() + timeout
    while True:
        if cancel.is_set():
            return False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        if lock.acquire(timeout=min(0.25, remaining)):
            # The client may have gone away during the final attempt; holding the lock for a
            # request nobody is waiting for is exactly what this exists to prevent.
            if cancel.is_set():
                lock.release()
                return False
            return True
