import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["healthy", "degraded"]
    assert data["piper_runtime"] == "available"
    assert data["cpu_execution"] is True
    assert "installed_voices_count" in data
    assert "version" in data
