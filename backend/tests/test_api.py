from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_session, init_db
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("AILKG_SECRET_FILE", str(tmp_path / "secrets.json"))
    engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_session() -> Generator[Session, None, None]:
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_model_settings_mask_api_key(client: TestClient):
    response = client.put(
        "/settings/model",
        json={
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-chat",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0.2,
            "max_tokens": 4096,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "DeepSeek"
    assert payload["api_key_reference"] == "model:deepseek:api_key"
    assert payload["api_key_mask"] == "sk-1...cdef"
    assert "1234567890" not in str(payload)


def test_source_settings_replace_existing_configs(client: TestClient):
    response = client.put(
        "/settings/sources",
        json=[
            {
                "name": "GitHub",
                "type": "builtin",
                "enabled": True,
                "url_or_domain": "github.com",
            },
            {
                "name": "AI RSS",
                "type": "rss",
                "enabled": True,
                "url_or_domain": "https://example.com/feed.xml",
                "language_hint": "en",
            },
        ],
    )

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["GitHub", "AI RSS"]

    list_response = client.get("/settings/sources")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 2


def test_create_and_list_runs(client: TestClient):
    response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})

    assert response.status_code == 201
    created = response.json()
    assert created["keyword"] == "RAG"
    assert created["mode"] == "light"
    assert created["status"] == "pending"

    list_response = client.get("/runs")
    assert list_response.status_code == 200
    assert [item["keyword"] for item in list_response.json()] == ["RAG"]


def test_collect_run_without_sources_marks_partial(client: TestClient):
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    collect_response = client.post(f"/runs/{run_id}/collect")

    assert collect_response.status_code == 200
    payload = collect_response.json()
    assert payload["status"] == "partial"
    assert "No source candidates" in payload["error_summary"]

    sources_response = client.get(f"/runs/{run_id}/sources")
    assert sources_response.status_code == 200
    assert sources_response.json() == []


def test_cards_and_graph_endpoints(client: TestClient):
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/generate")

    cards_response = client.get(f"/runs/{run_id}/cards")
    graph_response = client.get("/knowledge/graph")

    assert cards_response.status_code == 200
    assert len(cards_response.json()) == 3
    assert graph_response.status_code == 200
    graph = graph_response.json()
    assert len(graph["nodes"]) >= 3
    assert len(graph["edges"]) >= 2
