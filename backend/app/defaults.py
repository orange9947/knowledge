from app.schemas import SourceConfigWrite


def default_source_configs() -> list[SourceConfigWrite]:
    return [
        SourceConfigWrite(
            name="GitHub repositories",
            type="builtin",
            enabled=True,
            url_or_domain="github.com",
            language_hint="en",
            crawl_depth=1,
        ),
        SourceConfigWrite(
            name="Juejin search",
            type="search_page",
            enabled=True,
            url_or_domain="https://juejin.cn/search?query={keyword}&type=0",
            language_hint="zh",
            crawl_depth=1,
        ),
        SourceConfigWrite(
            name="Dev.to search",
            type="search_page",
            enabled=True,
            url_or_domain="https://dev.to/search?q={keyword}",
            language_hint="en",
            crawl_depth=1,
        ),
        SourceConfigWrite(
            name="Stack Overflow search",
            type="search_page",
            enabled=True,
            url_or_domain="https://stackoverflow.com/search?q={keyword}",
            language_hint="en",
            crawl_depth=1,
        ),
        SourceConfigWrite(
            name="Hacker News search",
            type="search_page",
            enabled=True,
            url_or_domain="https://hn.algolia.com/?q={keyword}",
            language_hint="en",
            crawl_depth=1,
        ),
        SourceConfigWrite(
            name="Google News technology RSS",
            type="rss",
            enabled=True,
            url_or_domain="https://news.google.com/rss/search?q={keyword}%20technology&hl=en-US&gl=US&ceid=US:en",
            language_hint="en",
            crawl_depth=1,
        ),
    ]
