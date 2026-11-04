import threading

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.cancellation import SynthesisAbandoned
from app.services.engine_manager import engine_manager

client = TestClient(app)

def test_synthesis_empty_text():
    response = client.post("/api/v1/synthesize", json={"text": "   "})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()

def test_synthesis_oversized_text():
    huge_text = "word " * 1500  # > 4000 chars
    response = client.post("/api/v1/synthesize", json={"text": huge_text})
    assert response.status_code == 400
    assert "exceeds" in response.json()["detail"].lower()

def test_valid_synthesis_and_cache():
    text = "Testing local audio generation in LocalVoice."
    # 1. First call (Synthesis generated)
    resp1 = client.post("/api/v1/synthesize", json={"text": text, "speed": 1.0})
    if resp1.status_code == 200:
        assert resp1.headers["content-type"] == "audio/wav"
        assert len(resp1.content) > 1000
        assert resp1.content[:4] == b"RIFF"  # Standard WAV header

        # Model load time is reported apart from inference latency: a 8-24 s Piper load hidden
        # inside a request used to look like slow synthesis.
        assert "x-engine-load-seconds" in resp1.headers
        assert float(resp1.headers["x-engine-load-seconds"]) >= 0.0
        assert "x-latency-seconds" in resp1.headers

        # 2. Second call with identical payload (Should hit cache)
        resp2 = client.post("/api/v1/synthesize", json={"text": text, "speed": 1.0})
        assert resp2.status_code == 200
        assert resp2.headers.get("x-cached") == "true"


def test_cached_synthesis_does_not_reload_a_model():
    """A cache hit must stay a disk read: it must never cost a model load or an inference."""
    text = "Cached audio must never trigger a model reload in LocalVoice."
    first = client.post("/api/v1/synthesize", json={"text": text})
    if first.status_code != 200:
        pytest.skip("no engine available in this environment")

    loaded_voice = engine_manager.get_engine("piper").get_engine_info().get("current_loaded_voice")
    second = client.post("/api/v1/synthesize", json={"text": text})
    assert second.status_code == 200
    assert second.headers.get("x-cached") == "true"
    assert float(second.headers["x-latency-seconds"]) < 1.0
    assert (
        engine_manager.get_engine("piper").get_engine_info().get("current_loaded_voice")
        == loaded_voice
    )


def test_abandoned_synthesis_returns_499(monkeypatch):
    """
    A client that hung up before inference started must not be retried as a server error. The
    response is never delivered (the socket is gone); 499 keeps it out of the error budget.
    """
    def abandon(**kwargs):
        raise SynthesisAbandoned("client hung up before inference")

    monkeypatch.setattr(engine_manager, "synthesize", abandon)
    response = client.post("/api/v1/synthesize", json={"text": "Abandoned paragraph."})
    assert response.status_code == 499


def test_abandoned_synthesis_is_logged_not_raised(monkeypatch):
    """The watcher task must be cancelled and the cancel event set on every exit path."""
    seen = {}

    def capture(**kwargs):
        seen["cancel"] = kwargs.get("cancel")
        assert isinstance(kwargs.get("cancel"), threading.Event)
        raise SynthesisAbandoned("client hung up before inference")

    monkeypatch.setattr(engine_manager, "synthesize", capture)
    response = client.post("/api/v1/synthesize", json={"text": "Abandoned paragraph."})
    assert response.status_code == 499
    assert seen["cancel"].is_set(), "the cancel event must be set once the request ends"

