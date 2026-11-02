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
