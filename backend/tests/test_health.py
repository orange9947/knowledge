from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ready_status():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "ready"
    assert payload["app_name"] == "AI Learning Knowledge Graph"
