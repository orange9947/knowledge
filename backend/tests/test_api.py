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
    initial_response = client.get("/settings/sources")
    assert initial_response.status_code == 200
    assert "GitHub repositories" in [item["name"] for item in initial_response.json()]

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
    base_response = client.post("/knowledge-bases", json={"name": "LLM"})
    knowledge_base_id = base_response.json()["id"]

    response = client.post(
        "/runs",
        json={"keyword": "RAG", "mode": "light", "knowledge_base_id": knowledge_base_id},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["keyword"] == "RAG"
    assert created["mode"] == "light"
    assert created["status"] == "pending"
    assert created["knowledge_base_id"] == knowledge_base_id

    list_response = client.get(f"/runs?knowledge_base_id={knowledge_base_id}")
    assert list_response.status_code == 200
    assert [item["keyword"] for item in list_response.json()] == ["RAG"]

    default_list_response = client.get("/runs")
    assert default_list_response.status_code == 200
    assert default_list_response.json() == []


def test_collect_run_uses_seeded_default_sources(client: TestClient):
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    collect_response = client.post(f"/runs/{run_id}/collect")

    assert collect_response.status_code == 200
    payload = collect_response.json()
    assert payload["status"] == "partial"

    sources_response = client.get(f"/runs/{run_id}/sources")
    assert sources_response.status_code == 200
    sources = sources_response.json()
    assert len(sources) > 0
    assert any(source["site"] in {"github.com", "news.google.com"} for source in sources)


def test_cards_and_graph_endpoints(client: TestClient):
    base_response = client.post("/knowledge-bases", json={"name": "RAG Base"})
    knowledge_base_id = base_response.json()["id"]
    run_response = client.post(
        "/runs",
        json={"keyword": "RAG", "mode": "light", "knowledge_base_id": knowledge_base_id},
    )
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/generate")

    cards_response = client.get(f"/runs/{run_id}/cards")
    graph_response = client.get(f"/knowledge/graph?knowledge_base_id={knowledge_base_id}")
    default_graph_response = client.get("/knowledge/graph")

    assert cards_response.status_code == 200
    assert len(cards_response.json()) == 3
    assert graph_response.status_code == 200
    graph = graph_response.json()
    assert len(graph["nodes"]) >= 3
    assert len(graph["edges"]) >= 2
    assert default_graph_response.status_code == 200
    assert default_graph_response.json() == {"nodes": [], "edges": []}


def test_knowledge_base_endpoints_create_default_and_custom_base(client: TestClient):
    list_response = client.get("/knowledge-bases")
    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == ["Default"]

    create_response = client.post(
        "/knowledge-bases",
        json={"name": "Robotics", "description": "Robot learning notes"},
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "Robotics"
    assert created["description"] == "Robot learning notes"

    list_response = client.get("/knowledge-bases")
    assert [item["name"] for item in list_response.json()] == ["Default", "Robotics"]
