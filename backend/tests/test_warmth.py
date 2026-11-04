"""
Tests for the v2.9 "engine warmth" work: residency policy, remembered voice/engine, abandoned
requests and single-flight de-duplication.

Background (docs/v2_9_engine_warmth.md): the controller idle-stops the backend after five
minutes, so every cost paid at start-up is paid again and again. Voice switching used to cost a
full model reload (5-11 s Kokoro, 8-24 s Piper) and that cost was attributed to "synthesizing".
"""

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.audio_cache import AudioCache
from app.services.cancellation import SynthesisAbandoned, acquire_lock
from app.services.engine_manager import engine_manager
from app.services.piper_engine import piper_engine
from app.services.state_store import StateStore

client = TestClient(app)


# --- Persisted state ---------------------------------------------------------------------

def test_state_store_remembers_voice_per_engine(tmp_path):
    store = StateStore(tmp_path / "state.json")
    assert store.last_voice("piper") is None

    store.set_last_voice("piper", "en_US-lessac-medium")
    store.set_last_voice("kokoro", "af_heart")

    # A fresh instance must see what the previous process wrote
    reopened = StateStore(tmp_path / "state.json")
    assert reopened.last_voice("piper") == "en_US-lessac-medium"
    assert reopened.last_voice("kokoro") == "af_heart"
    assert reopened.get("last_voice") == {
        "piper": "en_US-lessac-medium",
        "kokoro": "af_heart",
    }


def test_state_store_survives_a_corrupt_file(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{ this is not json", encoding="utf-8")

    store = StateStore(path)  # must not raise: a bad state file cannot fail a request
    assert store.get("active_engine") is None
    assert store.last_voice("kokoro") is None

    store.update(active_engine="kokoro")
    assert json.loads(path.read_text(encoding="utf-8"))["active_engine"] == "kokoro"


def test_state_store_ignores_blank_voice(tmp_path):
    store = StateStore(tmp_path / "state.json")
    store.set_last_voice("kokoro", None)
    store.set_last_voice("kokoro", "")
    assert store.last_voice("kokoro") is None


def test_warm_engine_prefers_last_used(tmp_path, monkeypatch):
    store = StateStore(tmp_path / "state.json")
    store.update(active_engine="piper", last_used_engine="kokoro")
    monkeypatch.setattr("app.services.engine_manager.state_store", store)

    # Last *used* wins over last *selected*: only synthesis proves a model was really needed
    assert engine_manager.warm_engine_id() == "kokoro"

    store.update(last_used_engine="not-an-engine")
    assert engine_manager.warm_engine_id() == "piper"

    store.update(active_engine="nonsense")
    assert engine_manager.warm_engine_id() == settings.default_engine


# --- Cancellation -----------------------------------------------------------------------

def test_acquire_lock_refuses_a_cancelled_request():
    lock = threading.Lock()
    cancel = threading.Event()
    cancel.set()

    assert acquire_lock(lock, cancel, timeout=5.0) is False
    # The lock must not have been taken on behalf of a request nobody is waiting for
    assert lock.acquire(blocking=False) is True
    lock.release()


def test_acquire_lock_gives_up_when_cancelled_while_waiting():
    lock = threading.Lock()
    cancel = threading.Event()
    lock.acquire()  # simulate an engine busy with an abandoned paragraph

    def cancel_soon() -> None:
        time.sleep(0.1)
        cancel.set()

    threading.Thread(target=cancel_soon, daemon=True).start()

    started = time.time()
    acquired = acquire_lock(lock, cancel, timeout=10.0)
    elapsed = time.time() - started

    assert acquired is False
    assert elapsed < 3.0, f"waited {elapsed:.2f}s for a lock the client no longer cares about"
    lock.release()


def test_acquire_lock_times_out_without_a_cancel_event():
    lock = threading.Lock()
    lock.acquire()
    try:
        assert acquire_lock(lock, None, timeout=0.1) is False
    finally:
        lock.release()


def test_cancelled_synthesis_never_reaches_the_engine():
    if not piper_engine.is_installed():
        pytest.skip("Piper is not installed")

    cancel = threading.Event()
    cancel.set()
    before = piper_engine.total_requests

    with pytest.raises(SynthesisAbandoned):
        piper_engine.synthesize(
            text="This paragraph was abandoned before it started.",
            voice_id=piper_engine.current_voice_id or settings.default_voice_id,
            cancel=cancel,
        )

    # Counted as a failed attempt, and nothing was inferred
    assert piper_engine.total_requests == before + 1
    assert piper_engine.failed_requests >= 1


# --- Single flight ----------------------------------------------------------------------

def test_single_flight_gives_one_owner_per_key(tmp_path):
    cache = AudioCache(cache_dir=tmp_path, max_bytes=10_000)

    assert cache.claim("key-a") is True
    # A second request for identical audio is a duplicate, not a second inference
    assert cache.claim("key-a") is False

    cache.release("key-a")
    # Once released, the key can be claimed again
    assert cache.claim("key-a") is True
    cache.release("key-a")
    assert cache.claim("key-a") is True, "the key must not stay claimed after release"


def test_single_flight_makes_duplicates_wait_for_the_owner(tmp_path):
    """A duplicate must wait for the in-flight pass instead of queueing behind the engine."""
    cache = AudioCache(cache_dir=tmp_path, max_bytes=10_000)
    order: list[str] = []
    owner_started = threading.Event()

    def owner() -> None:
        with cache.single_flight("key-c") as is_owner:
            assert is_owner is True
            owner_started.set()
            time.sleep(0.2)
            order.append("owner")

    owner_thread = threading.Thread(target=owner, daemon=True)
    owner_thread.start()
    assert owner_started.wait(2.0), "the owning pass never started"

    with cache.single_flight("key-c", timeout=5.0) as is_owner:
        assert is_owner is False
        order.append("duplicate")

    owner_thread.join(timeout=5.0)
    assert order == ["owner", "duplicate"], f"duplicate did not wait for the owner: {order}"


def test_single_flight_releases_key_after_an_error(tmp_path):
    cache = AudioCache(cache_dir=tmp_path, max_bytes=10_000)

    with pytest.raises(RuntimeError):
        with cache.single_flight("key-b", timeout=1.0):
            raise RuntimeError("synthesis blew up")

    # A failed pass must not wedge the key for every later request
    assert cache.claim("key-b") is True
    cache.release("key-b")


# --- Residency reporting -----------------------------------------------------------------

def test_metrics_report_both_engines_and_residency():
    response = client.get("/api/v1/metrics")
    assert response.status_code == 200
    data = response.json()

    assert data["active_engine"] in ("piper", "kokoro")
    assert set(data["resident_engines"]) == {"piper", "kokoro"}
    assert set(data["engines"]) == {"piper", "kokoro"}
    for engine_id, metrics in data["engines"].items():
        assert metrics["engine"] == engine_id
        assert "is_loaded" in metrics
        assert "load_seconds" in metrics
        assert "average_latency_seconds" in metrics

    # The extension's diagnostics panel reads these process-wide totals off the top level, so a
    # per-engine-only response would silently blank that panel.
    for key in ("total_requests", "successful_requests", "failed_requests",
                "average_latency_seconds", "cache_stats"):
        assert key in data, f"/metrics dropped the panel's '{key}' field"
    assert data["total_requests"] == sum(m["total_requests"] for m in data["engines"].values())
    assert data["failed_requests"] == sum(m["failed_requests"] for m in data["engines"].values())
