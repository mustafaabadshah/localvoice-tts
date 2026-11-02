import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_list_voices():
    response = client.get("/api/v1/voices")
    assert response.status_code == 200
    data = response.json()
    assert "total_count" in data
    assert "voices" in data
    assert isinstance(data["voices"], list)

def test_voice_path_traversal_rejection():
    # Attempting to query "../etc/passwd" or malformed paths
    response = client.get("/api/v1/voices/..%2F..%2Fsecret")
    assert response.status_code in [400, 404]

def test_get_nonexistent_voice():
    response = client.get("/api/v1/voices/non_existent_voice_99999")
    assert response.status_code == 404
