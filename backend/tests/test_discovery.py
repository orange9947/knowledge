from app import models
from app.discovery import (
    dedupe_candidates,
    discover_candidates,
    normalize_url,
    parse_feed_entries,
    SourceCandidate,
)


def test_normalize_url_removes_trailing_slash_and_lowercases_host():
    assert normalize_url("HTTPS://Example.COM/path/?b=1") == "https://example.com/path?b=1"


def test_dedupe_candidates_filters_duplicates_and_non_http():
    candidates = dedupe_candidates(
        [
            SourceCandidate(url="https://example.com/a/"),
            SourceCandidate(url="https://example.com/a"),
            SourceCandidate(url="ftp://example.com/file"),
        ]
    )

    assert [candidate.url for candidate in candidates] == ["https://example.com/a"]


def test_parse_feed_entries_matches_keyword():
    feed = """
    <rss><channel>
      <item>
        <title>RAG systems</title>
        <link>https://example.com/rag</link>
        <description>Retrieval augmented generation</description>
      </item>
      <item>
        <title>Other</title>
        <link>https://example.com/other</link>
      </item>
    </channel></rss>
    """

    candidates = parse_feed_entries(feed, "RAG", "https://example.com/feed.xml", "en")

    assert len(candidates) == 1
    assert candidates[0].url == "https://example.com/rag"
    assert candidates[0].language == "en"


def test_discover_candidates_uses_configured_sources():
    configs = [
        models.SourceConfig(name="GitHub", type="builtin", enabled=True, url_or_domain="github.com"),
        models.SourceConfig(name="Docs", type="entry_url", enabled=True, url_or_domain="https://docs.example.com/ai"),
        models.SourceConfig(
            name="RSS",
            type="rss",
            enabled=True,
            url_or_domain="https://example.com/feed.xml",
            language_hint="en",
        ),
    ]
    feed = """
    <rss><channel>
      <item><title>AI Agent pattern</title><link>https://example.com/agent</link></item>
    </channel></rss>
    """

    candidates = discover_candidates("AI Agent", configs, "light", fetch_text=lambda _: feed)

    assert [candidate.site for candidate in candidates] == [
        "github.com",
        "docs.example.com",
        "example.com",
    ]
