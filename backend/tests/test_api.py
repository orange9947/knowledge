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
    assert "GitHub 仓库" in [item["name"] for item in initial_response.json()]

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


def test_run_detail_status_and_knowledge_search(client: TestClient):
    base_response = client.post("/knowledge-bases", json={"name": "Search Base"})
    knowledge_base_id = base_response.json()["id"]
    run_response = client.post(
        "/runs",
        json={"keyword": "Graph RAG", "mode": "light", "knowledge_base_id": knowledge_base_id},
    )
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/generate")

    detail_response = client.get(f"/runs/{run_id}")
    status_response = client.get(f"/runs/{run_id}/status")
    search_response = client.get(f"/knowledge/search?knowledge_base_id={knowledge_base_id}&q=Graph")

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["run"]["id"] == run_id
    assert len(detail["cards"]) == 3
    assert status_response.status_code == 200
    assert status_response.json()["id"] == run_id
    assert search_response.status_code == 200
    nodes = search_response.json()
    assert any(node["name"] == "Graph RAG" for node in nodes)

    node_id = nodes[0]["id"]
    node_response = client.get(f"/knowledge/nodes/{node_id}?knowledge_base_id={knowledge_base_id}")
    wrong_base_response = client.get(f"/knowledge/nodes/{node_id}?knowledge_base_id=1")
    assert node_response.status_code == 200
    assert wrong_base_response.status_code == 404


def test_run_and_source_retention_delete_and_clear_text(client: TestClient):
    run_response = client.post("/runs", json={"keyword": "Retention", "mode": "light"})
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/generate")

    detail_response = client.get(f"/runs/{run_id}")
    source_id = detail_response.json()["sources"][0]["id"] if detail_response.json()["sources"] else None
    if source_id is None:
        client.post(f"/runs/{run_id}/collect")
        detail_response = client.get(f"/runs/{run_id}")
        source_id = detail_response.json()["sources"][0]["id"]

    pin_run_response = client.patch(f"/runs/{run_id}/retention", json={"is_pinned": True})
    pin_source_response = client.patch(f"/sources/{source_id}/retention", json={"is_pinned": True})
    clear_response = client.post(f"/sources/{source_id}/clear-text")

    assert pin_run_response.status_code == 200
    assert pin_run_response.json()["is_pinned"] is True
    assert pin_source_response.status_code == 200
    assert pin_source_response.json()["is_pinned"] is True
    assert clear_response.status_code == 200
    assert clear_response.json()["extracted_text"] is None
    assert clear_response.json()["url"]

    delete_source_response = client.delete(f"/sources/{source_id}")
    assert delete_source_response.status_code == 204
    detail_after_source_delete = client.get(f"/runs/{run_id}").json()
    assert all(source["id"] != source_id for source in detail_after_source_delete["sources"])
    assert all(source_id not in card["source_ids"] for card in detail_after_source_delete["cards"])

    delete_run_response = client.delete(f"/runs/{run_id}")
    assert delete_run_response.status_code == 204
    assert client.get(f"/runs/{run_id}").status_code == 404


def test_knowledge_base_endpoints_create_default_and_custom_base(client: TestClient):
    list_response = client.get("/knowledge-bases")
    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == ["默认知识库"]

    create_response = client.post(
        "/knowledge-bases",
        json={"name": "Robotics", "description": "Robot learning notes"},
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "Robotics"
    assert created["description"] == "Robot learning notes"

    list_response = client.get("/knowledge-bases")
    assert [item["name"] for item in list_response.json()] == ["默认知识库", "Robotics"]
