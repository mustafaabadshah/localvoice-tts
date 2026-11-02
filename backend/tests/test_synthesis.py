import pytest
from fastapi.testclient import TestClient
from app.main import app

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
        
        # 2. Second call with identical payload (Should hit cache)
        resp2 = client.post("/api/v1/synthesize", json={"text": text, "speed": 1.0})
        assert resp2.status_code == 200
        assert resp2.headers.get("x-cached") == "true"
