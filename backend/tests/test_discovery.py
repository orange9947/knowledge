from app import models
from app.discovery import (
    dedupe_candidates,
    discover_candidates,
    extract_search_result_links,
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

    github_payload = """
    {
      "items": [
        {
          "full_name": "example/ai-agent",
          "html_url": "https://github.com/example/ai-agent",
          "description": "AI Agent repository"
        }
      ]
    }
    """

    def fetch(url: str) -> str:
        if "api.github.com" in url:
            return github_payload
        return feed

    candidates = discover_candidates("AI Agent", configs, "light", fetch_text=fetch)

    assert [candidate.site for candidate in candidates] == [
        "github.com",
        "docs.example.com",
        "example.com",
    ]
    assert candidates[0].url == "https://github.com/example/ai-agent"


def test_discover_candidates_balances_high_volume_sources():
    configs = [
        models.SourceConfig(name="GitHub", type="builtin", enabled=True, url_or_domain="github.com"),
        models.SourceConfig(name="Docs", type="entry_url", enabled=True, url_or_domain="https://docs.example.com/ai"),
    ]
    repositories = ", ".join(
        f"""
        {{
          "full_name": "example/ai-agent-{index}",
          "html_url": "https://github.com/example/ai-agent-{index}",
          "description": "AI Agent repository"
        }}
        """
        for index in range(12)
    )
    github_payload = f'{{"items": [{repositories}]}}'

    candidates = discover_candidates("AI Agent", configs, "light", fetch_text=lambda _: github_payload)

    assert len(candidates) == 10
    assert "https://docs.example.com/ai" in [candidate.url for candidate in candidates]


def test_discover_candidates_expands_keyword_templates_and_domains():
    configs = [
        models.SourceConfig(name="Juejin", type="domain", enabled=True, url_or_domain="juejin.cn", language_hint="zh"),
        models.SourceConfig(
            name="Google News",
            type="rss",
            enabled=True,
            url_or_domain="https://news.example.com/rss?q={keyword}",
            language_hint="en",
        ),
        models.SourceConfig(
            name="Search",
            type="search_page",
            enabled=True,
            url_or_domain="https://search.example.com/?q={keyword}",
            language_hint="en",
        ),
    ]
    feed = """
    <rss><channel>
      <item><title>AI Agent news</title><link>https://news.example.com/agent</link></item>
    </channel></rss>
    """
    search_html = """
    <html><body>
      <a href="https://dev.to/example/ai-agent-guide">AI Agent guide</a>
    </body></html>
    """

    def fetch(url: str) -> str:
        if "rss" in url:
            assert "AI+Agent" in url
            return feed
        assert "AI+Agent" in url
        return search_html

    candidates = discover_candidates("AI Agent", configs, "light", fetch_text=fetch)

    assert "https://juejin.cn/search?query=AI+Agent&type=0" not in [candidate.url for candidate in candidates]
    assert "https://news.example.com/agent" in [candidate.url for candidate in candidates]
    assert "https://dev.to/example/ai-agent-guide" in [candidate.url for candidate in candidates]


def test_search_page_returns_no_candidate_when_no_article_links():
    configs = [
        models.SourceConfig(
            name="Search",
            type="search_page",
            enabled=True,
            url_or_domain="https://search.example.com/?q={keyword}",
            language_hint="en",
        ),
    ]
    html = """
    <html><body>
      <a href="https://accounts.google.com/login">AI Agent login</a>
      <a href="/about">About this search site</a>
    </body></html>
    """

    candidates = discover_candidates("AI Agent", configs, "light", fetch_text=lambda _: html)

    assert candidates == []


def test_extract_search_result_links_filters_low_value_links():
    html = """
    <a href="/url?q=https%3A%2F%2Fexample.com%2Fai-agent">AI Agent article</a>
    <a href="https://accounts.google.com/login">AI Agent login</a>
    <a href="https://example.com/other">Unrelated</a>
    """

    candidates = extract_search_result_links(html, "https://www.google.com/search?q=AI+Agent", "AI Agent", "en")

    assert [candidate.url for candidate in candidates] == ["https://example.com/ai-agent"]


def test_extract_search_result_links_ignores_site_navigation():
    html = """
    <a href="https://juejin.cn/search?query=RAG&type=2">文章</a>
    <a href="https://juejin.cn/post/7440000000000000000">RAG 实践指南</a>
    <a href="https://dev.to/search?q=RAG">RAG search</a>
    <a href="https://dev.to/team/rag-for-apps">RAG for apps</a>
    """

    candidates = extract_search_result_links(html, "https://juejin.cn/search?query=RAG&type=0", "RAG", "zh")

    assert [candidate.url for candidate in candidates] == [
        "https://juejin.cn/post/7440000000000000000",
        "https://dev.to/team/rag-for-apps",
    ]


def test_extract_search_result_links_keeps_practical_community_sources():
    html = """
    <a href="https://www.zhihu.com/search?type=content&q=RAG">RAG 搜索</a>
    <a href="https://www.zhihu.com/question/123456789/answer/987654321">RAG 实践问答</a>
    <a href="https://sspai.com/post/88888">RAG 自动化工作流</a>
    <a href="https://www.infoq.cn/article/rag-production-guide">RAG 工程实践</a>
    <a href="https://blog.csdn.net/example/article/details/123456">RAG 部署记录</a>
    <a href="https://cloud.tencent.com/developer/article/2345678">RAG 云端实践</a>
    <a href="https://medium.com/example/rag-for-apps-123">RAG for apps</a>
    <a href="https://www.reddit.com/r/MachineLearning/comments/abc123/rag_in_prod/">RAG in production</a>
    <a href="https://arxiv.org/abs/2501.12345">RAG paper</a>
    """

    candidates = extract_search_result_links(html, "https://www.zhihu.com/search?q=RAG", "RAG", "zh")

    assert [candidate.url for candidate in candidates] == [
        "https://www.zhihu.com/question/123456789/answer/987654321",
        "https://sspai.com/post/88888",
        "https://www.infoq.cn/article/rag-production-guide",
        "https://blog.csdn.net/example/article/details/123456",
        "https://cloud.tencent.com/developer/article/2345678",
        "https://medium.com/example/rag-for-apps-123",
        "https://www.reddit.com/r/MachineLearning/comments/abc123/rag_in_prod",
    ]
