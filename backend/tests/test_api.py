from collections.abc import Generator

import httpx
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


def test_model_connection_test_uses_saved_or_inline_api_key(client: TestClient, monkeypatch):
    client.put(
        "/settings/model",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0.2,
            "max_tokens": 4096,
        },
    )
    original_client = httpx.Client
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            request=request,
            json={"choices": [{"message": {"content": "连接成功"}}]},
        )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))

    response = client.post(
        "/settings/model/test",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "default_temperature": 0,
            "max_tokens": 1024,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["message"] == "模型连接成功"
    assert requests[0].url == "https://api.example.com/v1/chat/completions"
    assert requests[0].headers["authorization"] == "Bearer sk-1234567890abcdef"


def test_model_connection_test_requires_api_key(client: TestClient):
    response = client.post(
        "/settings/model/test",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "default_temperature": 0,
            "max_tokens": 1024,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "message": "请先填写或保存 API 密钥",
        "model": "test-model",
        "latency_ms": None,
    }


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
    base_response = client.post(
        "/knowledge-bases",
        json={"name": "LLM", "learning_prompt": "我是初学者"},
    )
    knowledge_base = base_response.json()
    knowledge_base_id = knowledge_base["id"]
    assert knowledge_base["learning_prompt"] == "我是初学者"

    update_response = client.patch(
        f"/knowledge-bases/{knowledge_base_id}",
        json={"learning_prompt": "关注实践项目"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["learning_prompt"] == "关注实践项目"

    clear_response = client.patch(
        f"/knowledge-bases/{knowledge_base_id}",
        json={"learning_prompt": None},
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["learning_prompt"] is None

    response = client.post(
        "/runs",
        json={
            "keyword": "RAG",
            "mode": "light",
            "knowledge_base_id": knowledge_base_id,
            "learning_prompt": "本次关注工具链",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["keyword"] == "RAG"
    assert created["mode"] == "light"
    assert created["status"] == "pending"
    assert created["knowledge_base_id"] == knowledge_base_id
    assert created["learning_prompt"] == "本次关注工具链"

    list_response = client.get(f"/runs?knowledge_base_id={knowledge_base_id}")
    assert list_response.status_code == 200
    assert [item["keyword"] for item in list_response.json()] == ["RAG"]

    default_list_response = client.get("/runs")
    assert default_list_response.status_code == 200
    assert default_list_response.json() == []


def test_collect_run_uses_seeded_default_sources(client: TestClient, monkeypatch):
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.github.com/search/repositories" in url:
            return httpx.Response(
                200,
                request=request,
                json={
                    "items": [
                        {
                            "full_name": "example/rag",
                            "html_url": "https://github.com/example/rag",
                            "description": "RAG repository",
                        }
                    ]
                },
            )
        if "github.com/example/rag" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG repo</title><body><p>" + ("RAG content " * 80) + "</p></body></html>",
            )
        return httpx.Response(404, request=request)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    collect_response = client.post(f"/runs/{run_id}/collect")

    assert collect_response.status_code == 200
    payload = collect_response.json()
    assert payload["status"] == "completed"

    sources_response = client.get(f"/runs/{run_id}/sources")
    assert sources_response.status_code == 200
    sources = sources_response.json()
    assert len(sources) > 0
    assert any(source["url"] == "https://github.com/example/rag" for source in sources)


def test_collect_run_reads_article_candidates_not_search_pages(client: TestClient, monkeypatch):
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.github.com/search/repositories" in url:
            return httpx.Response(
                200,
                request=request,
                json={
                    "items": [
                        {
                            "full_name": "example/rag-lab",
                            "html_url": "https://github.com/example/rag-lab",
                            "description": "RAG project",
                        }
                    ]
                },
            )
        if "github.com/example/rag-lab" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG Lab</title><body><p>" + ("RAG article body " * 80) + "</p></body></html>",
            )
        if "juejin.cn/search" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text='<a href="https://juejin.cn/post/7440000000000000000">RAG 实践指南</a>',
            )
        if "juejin.cn/post/7440000000000000000" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG 实践指南</title><body><p>" + ("RAG 中文正文 " * 80) + "</p></body></html>",
            )
        return httpx.Response(404, request=request)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    client.put(
        "/settings/sources",
        json=[
            {
                "name": "GitHub 仓库",
                "type": "builtin",
                "enabled": True,
                "url_or_domain": "github.com",
                "language_hint": "en",
            },
            {
                "name": "掘金搜索",
                "type": "search_page",
                "enabled": True,
                "url_or_domain": "https://juejin.cn/search?query={keyword}&type=0",
                "language_hint": "zh",
            },
        ],
    )
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    collect_response = client.post(f"/runs/{run_id}/collect")

    assert collect_response.status_code == 200
    assert collect_response.json()["status"] == "completed"
    sources = client.get(f"/runs/{run_id}/sources").json()
    urls = [source["url"] for source in sources]
    assert "https://github.com/example/rag-lab" in urls
    assert "https://juejin.cn/post/7440000000000000000" in urls
    assert all("/search" not in url for url in urls)


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
    cards = cards_response.json()
    assert len(cards) == 6
    assert {card["approval_status"] for card in cards} == {"candidate"}
    assert graph_response.status_code == 200
    assert graph_response.json() == {"nodes": [], "edges": []}
    assert default_graph_response.status_code == 200
    assert default_graph_response.json() == {"nodes": [], "edges": []}

    approve_response = client.post(
        f"/runs/{run_id}/cards/approve",
        json={"card_ids": [cards[0]["id"], cards[-1]["id"]]},
    )
    assert approve_response.status_code == 200
    approved_cards = client.get(f"/runs/{run_id}/cards").json()
    assert [card["approval_status"] for card in approved_cards].count("approved") == 2
    approved_graph = client.get(f"/knowledge/graph?knowledge_base_id={knowledge_base_id}").json()
    assert len(approved_graph["nodes"]) >= 2


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
    assert len(detail["cards"]) == 6
    assert status_response.status_code == 200
    assert status_response.json()["id"] == run_id
    assert search_response.status_code == 200
    nodes = search_response.json()
    assert nodes == []

    cards = detail_response.json()["cards"]
    approve_response = client.post(
        f"/runs/{run_id}/cards/approve",
        json={"card_ids": [card["id"] for card in cards]},
    )
    assert approve_response.status_code == 200
    search_after_approval = client.get(f"/knowledge/search?knowledge_base_id={knowledge_base_id}&q=Graph")
    nodes = search_after_approval.json()
    assert any(node["name"] == "Graph RAG" for node in nodes)

    node_id = nodes[0]["id"]
    node_response = client.get(f"/knowledge/nodes/{node_id}?knowledge_base_id={knowledge_base_id}")
    wrong_base_response = client.get(f"/knowledge/nodes/{node_id}?knowledge_base_id=1")
    assert node_response.status_code == 200
    assert wrong_base_response.status_code == 404


def test_summarize_run_endpoint_adds_summary_and_keyword_hint(client: TestClient, monkeypatch):
    client.put(
        "/settings/model",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0,
            "max_tokens": 4096,
        },
    )
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "docs.example.com/rag" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG Doc</title><body><p>" + ("RAG document body " * 80) + "</p></body></html>",
            )
        content = """
        {
          "cards": [
            {"type": "summary", "title": "RAG 本次总结", "summary": "新增上下文压缩方法", "details": "已过滤重复内容", "source_indexes": [0]},
            {"type": "keyword_hint", "title": "上下文压缩", "summary": "与 RAG 检索后处理相关", "details": "适合继续学习", "source_indexes": [0]}
          ],
          "nodes": [
            {"type": "keyword", "name": "RAG", "summary": "RAG", "aliases": [], "tags": ["keyword"]},
            {"type": "concept", "name": "上下文压缩", "summary": "减少冗余上下文", "aliases": [], "tags": ["keyword_hint"]}
          ],
          "edges": [
            {"source": "RAG", "target": "上下文压缩", "type": "related", "confidence": 0.8, "source_indexes": [0]}
          ]
        }
        """
        return httpx.Response(200, request=request, json={"choices": [{"message": {"content": content}}]})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    client.put(
        "/settings/sources",
        json=[
            {
                "name": "RAG Doc",
                "type": "entry_url",
                "enabled": True,
                "url_or_domain": "https://docs.example.com/rag",
                "language_hint": "en",
            },
        ],
    )
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/collect")

    response = client.post(f"/runs/{run_id}/summarize")

    assert response.status_code == 200
    cards = client.get(f"/runs/{run_id}/cards").json()
    assert any(card["type"] == "summary" and card["title"] == "RAG 本次总结" for card in cards)
    assert any(card["type"] == "keyword_hint" and card["title"] == "上下文压缩" for card in cards)


def test_ai_collect_endpoint_uses_model_targets_then_summarizes(client: TestClient, monkeypatch):
    client.put(
        "/settings/model",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0,
            "max_tokens": 4096,
        },
    )
    original_client = httpx.Client
    model_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal model_requests
        url = str(request.url)
        if "api.example.com" in url:
            model_requests += 1
            if model_requests == 1:
                content = """
                {"targets":[{"url":"https://docs.example.com/rag-guide","title":"RAG Guide","reason":"新增实践"}]}
                """
            else:
                content = """
                {
                  "cards": [
                    {"type": "summary", "title": "RAG AI 采集总结", "summary": "采集到新增实践", "details": "过滤重复内容", "source_indexes": [0]},
                    {"type": "keyword_hint", "title": "重排序", "summary": "牵连知识点", "details": "可继续学习", "source_indexes": [0]}
                  ],
                  "nodes": [
                    {"type": "keyword", "name": "RAG", "summary": "RAG", "aliases": [], "tags": ["keyword"]},
                    {"type": "concept", "name": "重排序", "summary": "rerank", "aliases": [], "tags": ["keyword_hint"]}
                  ],
                  "edges": [
                    {"source": "RAG", "target": "重排序", "type": "related", "confidence": 0.8, "source_indexes": [0]}
                  ]
                }
                """
            return httpx.Response(200, request=request, json={"choices": [{"message": {"content": content}}]})
        if "docs.example.com/rag-guide" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG Guide</title><body><p>" + ("RAG guide body " * 80) + "</p></body></html>",
            )
        return httpx.Response(404, request=request)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    response = client.post(f"/runs/{run_id}/ai-collect")

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    sources = client.get(f"/runs/{run_id}/sources").json()
    cards = client.get(f"/runs/{run_id}/cards").json()
    assert [source["url"] for source in sources] == ["https://docs.example.com/rag-guide"]
    assert any(card["title"] == "RAG AI 采集总结" for card in cards)
    assert any(card["title"] == "重排序" for card in cards)


def test_ai_collect_endpoint_returns_model_error_instead_of_500(client: TestClient, monkeypatch):
    client.put(
        "/settings/model",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0,
            "max_tokens": 4096,
        },
    )
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, request=request, json={"error": "upstream failed"})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]

    response = client.post(f"/runs/{run_id}/ai-collect")

    assert response.status_code == 502
    assert response.json()["detail"] == "模型服务返回错误（HTTP 502）。"
    run = client.get(f"/runs/{run_id}").json()["run"]
    assert run["status"] == "failed"
    assert run["error_summary"] == "模型服务返回错误（HTTP 502）。"


def test_summarize_endpoint_returns_model_error_instead_of_500(client: TestClient, monkeypatch):
    client.put(
        "/settings/model",
        json={
            "name": "OpenAI",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-1234567890abcdef",
            "default_temperature": 0,
            "max_tokens": 4096,
        },
    )
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "docs.example.com/rag" in url:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/html"},
                text="<html><title>RAG Doc</title><body><p>" + ("RAG document body " * 80) + "</p></body></html>",
            )
        return httpx.Response(503, request=request, json={"error": "busy"})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))
    client.put(
        "/settings/sources",
        json=[
            {
                "name": "RAG Doc",
                "type": "entry_url",
                "enabled": True,
                "url_or_domain": "https://docs.example.com/rag",
                "language_hint": "en",
            },
        ],
    )
    run_response = client.post("/runs", json={"keyword": "RAG", "mode": "light"})
    run_id = run_response.json()["id"]
    client.post(f"/runs/{run_id}/collect")

    response = client.post(f"/runs/{run_id}/summarize")

    assert response.status_code == 502
    assert response.json()["detail"] == "模型服务返回错误（HTTP 503）。"


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


def test_delete_knowledge_base_removes_scoped_data(client: TestClient):
    keep_response = client.post("/knowledge-bases", json={"name": "Keep"})
    delete_response = client.post("/knowledge-bases", json={"name": "Delete Me"})
    keep_id = keep_response.json()["id"]
    delete_id = delete_response.json()["id"]

    keep_run_response = client.post(
        "/runs",
        json={"keyword": "Keep RAG", "mode": "light", "knowledge_base_id": keep_id},
    )
    delete_run_response = client.post(
        "/runs",
        json={"keyword": "Delete RAG", "mode": "light", "knowledge_base_id": delete_id},
    )
    keep_run_id = keep_run_response.json()["id"]
    delete_run_id = delete_run_response.json()["id"]
    client.post(f"/runs/{keep_run_id}/generate")
    client.post(f"/runs/{delete_run_id}/generate")

    response = client.delete(f"/knowledge-bases/{delete_id}")

    assert response.status_code == 204
    bases = client.get("/knowledge-bases").json()
    assert "Delete Me" not in [item["name"] for item in bases]
    assert client.get(f"/runs?knowledge_base_id={delete_id}").status_code == 404
    assert client.get(f"/runs?knowledge_base_id={keep_id}").json()[0]["keyword"] == "Keep RAG"
    assert client.get(f"/knowledge/graph?knowledge_base_id={delete_id}").status_code == 404


def test_delete_last_knowledge_base_is_rejected(client: TestClient):
    base_id = client.get("/knowledge-bases").json()[0]["id"]

    response = client.delete(f"/knowledge-bases/{base_id}")

    assert response.status_code == 409
    assert response.json()["detail"] == "至少需要保留一个知识库"
