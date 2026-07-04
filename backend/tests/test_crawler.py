import httpx

from app.crawler import BodyTextParser, SourceCrawler
from app.discovery import SourceCandidate


def test_body_text_parser_extracts_title_and_body():
    parser = BodyTextParser()
    parser.feed(
        """
        <html><head><title>Example</title><script>bad()</script></head>
        <body><h1>Heading</h1><p>Useful text</p></body></html>
        """
    )

    assert parser.title == "Example"
    assert "Useful text" in parser.body_text()
    assert "bad()" not in parser.body_text()


def test_crawler_success_with_mock_transport(monkeypatch):
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><title>Doc</title><body><p>" + ("AI Agent " * 80) + "</p></body></html>",
        )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))

    payload = SourceCrawler().crawl(1, SourceCandidate(url="https://example.com/doc"))

    assert payload.status == "success"
    assert payload.title == "Doc"
    assert payload.content_hash
    assert payload.quality_score and payload.quality_score > 0


def test_crawler_records_http_failure(monkeypatch):
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, request=request)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))

    payload = SourceCrawler().crawl(1, SourceCandidate(url="https://example.com/blocked"))

    assert payload.status == "failed"
    assert payload.status_reason == "http_status_403"


def test_crawler_extracts_json_text_as_partial_or_success(monkeypatch):
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "title": "AI Agent guide",
                "items": ["AI Agent orchestration " * 20, "Tool calling and retrieval"],
            },
        )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(handler)))

    payload = SourceCrawler().crawl(1, SourceCandidate(url="https://api.example.com/search"))

    assert payload.status in {"success", "partial"}
    assert "AI Agent guide" in (payload.extracted_text or "")
    assert payload.content_hash
