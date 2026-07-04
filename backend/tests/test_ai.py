import httpx
from types import SimpleNamespace

from app.ai import AIOrchestrator, Material, fallback_output
from app.models import ModelConfig


def test_fallback_output_generates_cards_nodes_and_edges():
    output = fallback_output("AI Agent", [])

    assert [card.type for card in output.cards] == [
        "key_point",
        "usage_method",
        "practice_project",
        "learning_path",
        "recommended_reading",
    ]
    assert any(node.type == "keyword" and node.name == "AI Agent" for node in output.nodes)
    assert any(edge.type == "contains" for edge in output.edges)


def test_fallback_source_node_does_not_reuse_keyword_name():
    output = fallback_output(
        "Example",
        [Material(title="Example", url="https://example.com", site="example.com", text="Example text")],
    )

    keyword_nodes = [node for node in output.nodes if node.type == "keyword"]
    source_nodes = [node for node in output.nodes if node.type == "source"]
    assert keyword_nodes[0].name == "Example"
    assert source_nodes[0].name.startswith("来源：Example")


def test_provider_output_gets_one_repair_attempt(monkeypatch):
    original_client = httpx.Client
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            content = "```json\n{\"cards\": [\n```"
        else:
            content = """
            {
              "cards": [
                {
                  "type": "foundation",
                  "title": "RAG 基础知识",
                  "summary": "RAG summary",
                  "details": "RAG details",
                  "source_indexes": [0]
                }
              ],
              "nodes": [
                {
                  "type": "keyword",
                  "name": "RAG",
                  "summary": "RAG node",
                  "aliases": [],
                  "tags": ["keyword"]
                }
              ],
              "edges": []
            }
            """
        return httpx.Response(
            200,
            request=request,
            json={"choices": [{"message": {"content": content}}]},
        )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))

    class SecretStoreStub:
        def get(self, key: str | None) -> str:
            return "sk-test"

    config = ModelConfig(
        name="test",
        base_url="https://api.example.com/v1",
        model="test-model",
        api_key_reference="model:test",
        default_temperature=0.2,
        max_tokens=4096,
    )
    output = AIOrchestrator(secret_store=SecretStoreStub()).generate(
        "RAG",
        [
            SimpleNamespace(
                status="success",
                extracted_text="RAG combines retrieval with generation.",
                snippet=None,
                title="RAG overview",
                site="example.com",
                url="https://example.com/rag",
            )
        ],
        config,
    )

    assert output.cards[0].title == "RAG 基础知识"
    assert len(requests) == 2
    repair_payload = requests[1].read().decode("utf-8")
    assert "Repair malformed model output" in repair_payload
