import threading
import time

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.engine_manager import engine_manager
from app.services.piper_engine import piper_engine
from app.services.kokoro_engine import kokoro_engine
from app.services.audio_cache import audio_cache

client = TestClient(app)

def test_list_engines():
    response = client.get("/api/v1/engines")
    assert response.status_code == 200
    data = response.json()
    assert "engines" in data
    assert "active_engine" in data
    
    engine_ids = [e["id"] for e in data["engines"]]
    assert "piper" in engine_ids
    assert "kokoro" in engine_ids

def test_health_includes_both_engines():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert "active_engine" in data
    assert "piper_runtime" in data
    assert "kokoro_runtime" in data
    assert "piper_installed_voices" in data
    assert "kokoro_installed_voices" in data

def test_engine_voices_filtering():
    # Piper voices
    resp_piper = client.get("/api/v1/voices?engine=piper")
    assert resp_piper.status_code == 200
    piper_data = resp_piper.json()
    assert piper_data["engine"] == "piper"
    assert piper_data["total_count"] >= 1
    assert any("lessac" in v["voice_id"] for v in piper_data["voices"])

    # Kokoro voices
    if kokoro_engine.is_installed():
        resp_kokoro = client.get("/api/v1/voices?engine=kokoro")
        assert resp_kokoro.status_code == 200
        kokoro_data = resp_kokoro.json()
        assert kokoro_data["engine"] == "kokoro"
        assert kokoro_data["total_count"] >= 50
        assert any(v["voice_id"] == "af_heart" for v in kokoro_data["voices"])

def test_engine_switching_and_isolation():
    # Select Piper
    resp1 = client.post("/api/v1/engines/select", json={"engine": "piper"})
    assert resp1.status_code == 200
    assert engine_manager.active_engine_id == "piper"

    # Synthesize with Piper
    syn_piper = client.post("/api/v1/synthesize", json={
        "text": "Piper test sentence.",
        "engine": "piper"
    })
    assert syn_piper.status_code == 200
    assert syn_piper.headers["X-Engine"] == "piper"
    assert len(syn_piper.content) > 1000

    # If Kokoro installed, switch to Kokoro
    if kokoro_engine.is_installed():
        resp2 = client.post("/api/v1/engines/select", json={"engine": "kokoro"})
        assert resp2.status_code == 200
        assert engine_manager.active_engine_id == "kokoro"
        
        # Verify Piper was unloaded
        assert piper_engine._loaded_voice is None

        # Synthesize with Kokoro
        syn_kokoro = client.post("/api/v1/synthesize", json={
            "text": "Kokoro test sentence.",
            "engine": "kokoro",
            "voice_id": "af_heart"
        })
        assert syn_kokoro.status_code == 200
        assert syn_kokoro.headers["X-Engine"] == "kokoro"
        assert len(syn_kokoro.content) > 1000

        # Switch back to Piper
        client.post("/api/v1/engines/select", json={"engine": "piper"})
        assert kokoro_engine._kokoro is None
        assert engine_manager.active_engine_id == "piper"

def test_health_check_never_loads_kokoro_model():
    """
    Regression: /health is polled every 5 s by the popup UI. It used to instantiate a
    full Kokoro ONNX session just to count voices (~3-6 s of CPU per poll on this class
    of hardware), which starved real synthesis requests.
    """
    kokoro_engine.unload()
    assert kokoro_engine._kokoro is None

    start = time.time()
    response = client.get("/api/v1/health")
    elapsed = time.time() - start

    assert response.status_code == 200
    data = response.json()
    assert data["kokoro_installed_voices"] >= 50
    assert kokoro_engine._kokoro is None, "health check must not build an ONNX session"
    # A session build costs 3-6 s on this class of hardware; allow slack for a loaded CPU
    assert elapsed < 2.0, f"health check took {elapsed:.2f}s - model was loaded again"


def test_voice_listing_never_loads_kokoro_model():
    """Regression: listing Kokoro voices must read the voice pack, not build the model."""
    kokoro_engine.unload()
    assert kokoro_engine._kokoro is None

    start = time.time()
    response = client.get("/api/v1/voices?engine=kokoro")
    elapsed = time.time() - start

    assert response.status_code == 200
    voices = [v["voice_id"] for v in response.json()["voices"]]
    assert "af_heart" in voices
    assert kokoro_engine._kokoro is None, "voice listing must not build an ONNX session"
    assert elapsed < 2.0, f"voice listing took {elapsed:.2f}s - model was loaded again"


def test_engine_switch_does_not_block_on_busy_engine():
    """
    Regression: unload() used to block on the synthesis lock while holding the manager
    lock, so switching away from a busy Kokoro stalled for the whole remaining pass
    (and queued every Piper request behind it).
    """
    if not kokoro_engine.is_installed():
        pytest.skip("Kokoro is not installed")

    engine_manager.active_engine_id = "kokoro"
    holding = threading.Event()
    stop_holding = threading.Event()

    def hold_synthesis_lock() -> None:
        with kokoro_engine._lock:
            holding.set()
            stop_holding.wait(10.0)

    holder = threading.Thread(target=hold_synthesis_lock, daemon=True)
    holder.start()
    assert holding.wait(2.0), "could not acquire the engine lock for the busy simulation"

    start = time.time()
    try:
        engine_manager.select_engine("piper")
        elapsed = time.time() - start
    finally:
        stop_holding.set()
        holder.join(timeout=2.0)

    # Must not wait for the simulated pass; a blocking unload would take 10 s here
    assert elapsed < 1.0, f"engine switch blocked for {elapsed:.2f}s on a busy engine"
    assert engine_manager.active_engine_id == "piper"
    assert kokoro_engine._unload_pending is True, "the unload should be deferred, not dropped"

    # Once the in-flight pass finishes, the deferred release must still free the model
    kokoro_engine.unload()
    assert kokoro_engine._unload_pending is False


def test_audio_cache_engine_separation():
    test_text = "Distinct engine cache separation test."
    key_piper = audio_cache.compute_key(test_text, "voice_test", 1.0, "fp", engine="piper")
    key_kokoro = audio_cache.compute_key(test_text, "voice_test", 1.0, "fp", engine="kokoro")
    
    assert key_piper != key_kokoro, "Piper and Kokoro cache keys MUST NOT collide"

def test_compare_endpoint():
    response = client.post("/api/v1/compare", json={
        "text": "Testing the comparative side by side benchmark feature.",
        "piper_voice_id": "en_US-lessac-medium",
        "kokoro_voice_id": "af_heart",
        "speed": 1.0
    })
    assert response.status_code == 200
    data = response.json()
    assert "piper" in data
    assert "kokoro" in data
    assert data["piper"]["status"] == "success"
    assert data["piper"]["real_time_factor"] is not None
    assert data["piper"]["audio_url"] is not None

    # Test comparison audio retrieval
    audio_resp = client.get(data["piper"]["audio_url"])
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"] == "audio/wav"
