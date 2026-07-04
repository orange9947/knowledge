import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse
from xml.etree import ElementTree

import httpx

from app import models


MODE_LIMITS = {
    "light": 10,
    "standard": 20,
    "deep": 50,
}


@dataclass(frozen=True)
class SourceCandidate:
    url: str
    title: str | None = None
    site: str | None = None
    language: str | None = None
    snippet: str | None = None
    published_at: datetime | None = None


def normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower() or "https"
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = parsed.query
    normalized = f"{scheme}://{netloc}{path}"
    if query:
        normalized = f"{normalized}?{query}"
    return normalized


def site_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    return parsed.netloc.lower() or None


def mode_limit(mode: str) -> int:
    return MODE_LIMITS.get(mode, MODE_LIMITS["light"])


def dedupe_candidates(candidates: Iterable[SourceCandidate]) -> list[SourceCandidate]:
    seen: set[str] = set()
    deduped: list[SourceCandidate] = []
    for candidate in candidates:
        if not is_http_url(candidate.url):
            continue
        normalized = normalize_url(candidate.url)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(SourceCandidate(**{**candidate.__dict__, "url": normalized}))
    return deduped


def discover_candidates(
    keyword: str,
    configs: Iterable[models.SourceConfig],
    mode: str,
    fetch_text: Callable[[str], str] | None = None,
) -> list[SourceCandidate]:
    fetcher = fetch_text or default_fetch_text
    candidates: list[SourceCandidate] = []
    for config in configs:
        if not config.enabled:
            continue
        if config.type == "entry_url":
            candidates.extend(_entry_url_candidates(config))
        elif config.type == "domain":
            candidates.extend(_domain_candidates(keyword, config, fetcher))
        elif config.type == "builtin":
            candidates.extend(_builtin_candidates(keyword, config, fetcher))
        elif config.type == "rss":
            candidates.extend(_rss_candidates(keyword, config, fetcher))
        elif config.type == "search_page":
            candidates.extend(_search_page_candidates(keyword, config, fetcher))
    return sorted(dedupe_candidates(candidates), key=_candidate_rank)[: mode_limit(mode)]


def parse_feed_entries(
    feed_xml: str,
    keyword: str,
    feed_url: str,
    language_hint: str | None = None,
) -> list[SourceCandidate]:
    keyword_lower = keyword.lower()
    try:
        root = ElementTree.fromstring(feed_xml)
    except ElementTree.ParseError:
        return []

    candidates: list[SourceCandidate] = []
    for item in root.findall(".//item"):
        title = _text(item, "title")
        link = _text(item, "link")
        snippet = _text(item, "description")
        published = _parse_date(_text(item, "pubDate"))
        if link and _matches_keyword(keyword_lower, title, snippet, link):
            candidates.append(
                SourceCandidate(
                    url=link,
                    title=title,
                    site=site_from_url(link) or site_from_url(feed_url),
                    language=language_hint,
                    snippet=snippet,
                    published_at=published,
                )
            )

    for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry"):
        title = _namespaced_text(entry, "title")
        snippet = _namespaced_text(entry, "summary") or _namespaced_text(entry, "content")
        link = _atom_link(entry)
        published = _parse_date(_namespaced_text(entry, "updated") or _namespaced_text(entry, "published"))
        if link and _matches_keyword(keyword_lower, title, snippet, link):
            candidates.append(
                SourceCandidate(
                    url=link,
                    title=title,
                    site=site_from_url(link) or site_from_url(feed_url),
                    language=language_hint,
                    snippet=snippet,
                    published_at=published,
                )
            )
    return dedupe_candidates(candidates)


def default_fetch_text(url: str) -> str:
    with httpx.Client(follow_redirects=True, timeout=10.0) as client:
        response = client.get(url, headers={"User-Agent": "AILearningKnowledgeGraph/0.1"})
        response.raise_for_status()
        return response.text


def is_http_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _entry_url_candidates(config: models.SourceConfig) -> list[SourceCandidate]:
    if not is_http_url(config.url_or_domain):
        return []
    url = config.url_or_domain or ""
    return [
        SourceCandidate(
            url=url,
            title=config.name,
            site=site_from_url(url),
            language=config.language_hint,
        )
    ]


def _domain_candidates(
    keyword: str,
    config: models.SourceConfig,
    fetch_text: Callable[[str], str],
) -> list[SourceCandidate]:
    if is_http_url(config.url_or_domain):
        return _entry_url_candidates(config)
    domain = _clean_domain(config.url_or_domain)
    if not domain:
        return []
    search_url = _domain_search_url(domain, quote_plus(keyword))
    try:
        html = fetch_text(search_url)
    except httpx.HTTPError:
        return []
    return extract_search_result_links(html, search_url, keyword, config.language_hint)


def _builtin_candidates(
    keyword: str,
    config: models.SourceConfig,
    fetch_text: Callable[[str], str],
) -> list[SourceCandidate]:
    marker = f"{config.name} {config.url_or_domain or ''}".lower()
    if "github" not in marker:
        return []
    api_url = f"https://api.github.com/search/repositories?q={quote_plus(keyword)}&per_page=10"
    try:
        payload = json.loads(fetch_text(api_url))
    except (httpx.HTTPError, json.JSONDecodeError, TypeError):
        return []
    return _github_repository_candidates(payload, config.language_hint or "en")


def _github_repository_candidates(payload: object, language_hint: str | None) -> list[SourceCandidate]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("items")
    if not isinstance(items, list):
        return []

    candidates: list[SourceCandidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        html_url = item.get("html_url")
        if not isinstance(html_url, str) or not is_http_url(html_url):
            continue
        full_name = item.get("full_name") if isinstance(item.get("full_name"), str) else None
        description = item.get("description") if isinstance(item.get("description"), str) else None
        candidates.append(
            SourceCandidate(
                url=html_url,
                title=full_name or site_from_url(html_url),
                site=site_from_url(html_url),
                language=language_hint,
                snippet=description,
            )
        )
    return dedupe_candidates(candidates)


def _rss_candidates(
    keyword: str,
    config: models.SourceConfig,
    fetch_text: Callable[[str], str],
) -> list[SourceCandidate]:
    feed_url = _keyword_url(config.url_or_domain or "", keyword)
    if not is_http_url(feed_url):
        return []
    try:
        feed_xml = fetch_text(feed_url)
    except httpx.HTTPError:
        return []
    return parse_feed_entries(feed_xml, keyword, feed_url, config.language_hint)


def _search_page_candidates(
    keyword: str,
    config: models.SourceConfig,
    fetch_text: Callable[[str], str],
) -> list[SourceCandidate]:
    if not config.enabled or not is_http_url(config.url_or_domain):
        return []
    url = _keyword_url(config.url_or_domain or "", keyword)
    try:
        html = fetch_text(url)
    except httpx.HTTPError:
        return []
    return extract_search_result_links(html, url, keyword, config.language_hint)


def extract_search_result_links(
    html: str,
    base_url: str,
    keyword: str,
    language_hint: str | None = None,
) -> list[SourceCandidate]:
    parser = LinkParser(base_url)
    parser.feed(html)
    keyword_lower = keyword.lower()
    candidates: list[SourceCandidate] = []
    for href, text in parser.links:
        url = _unwrap_redirect_url(href)
        if not is_http_url(url):
            continue
        site = site_from_url(url)
        if not site or _is_low_value_site(site):
            continue
        if not _looks_like_result_url(url):
            continue
        if keyword_lower not in f"{text} {url}".lower():
            continue
        candidates.append(
            SourceCandidate(
                url=url,
                title=text or site,
                site=site,
                language=language_hint,
                snippet=f"从 {site} 发现的候选素材。",
            )
        )
    return dedupe_candidates(candidates)


class LinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self._current_href: str | None = None
        self._current_text: list[str] = []
        self.links: list[tuple[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        self._current_href = urljoin(self.base_url, href)
        self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            stripped = data.strip()
            if stripped:
                self._current_text.append(stripped)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._current_href is None:
            return
        text = " ".join(self._current_text)
        self.links.append((self._current_href, text or None))
        self._current_href = None
        self._current_text = []


def _keyword_url(url: str, keyword: str) -> str:
    return url.replace("{keyword}", quote_plus(keyword))


def _clean_domain(value: str | None) -> str | None:
    if not value:
        return None
    stripped = value.strip().lower()
    if not stripped:
        return None
    parsed = urlparse(stripped if "://" in stripped else f"https://{stripped}")
    return parsed.netloc or None


def _domain_search_url(domain: str, keyword: str) -> str:
    if "juejin.cn" in domain:
        return f"https://juejin.cn/search?query={keyword}&type=0"
    if "dev.to" in domain:
        return f"https://dev.to/search?q={keyword}"
    if "stackoverflow.com" in domain:
        return f"https://stackoverflow.com/search?q={keyword}"
    return f"https://www.google.com/search?q=site%3A{domain}+{keyword}"


def _unwrap_redirect_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc.endswith("google.com") and parsed.path == "/url":
        target = parse_qs(parsed.query).get("q", [None])[0]
        if target:
            return target
    if parsed.netloc.endswith("bing.com") and parsed.path == "/ck/a":
        target = parse_qs(parsed.query).get("u", [None])[0]
        if target:
            return unquote(target)
    return url


def _is_low_value_site(site: str) -> bool:
    blocked = {
        "accounts.google.com",
        "support.google.com",
        "policies.google.com",
        "www.google.com",
        "google.com",
        "hn.algolia.com",
    }
    return site in blocked


def _looks_like_result_url(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    query = parsed.query.lower()
    if "juejin.cn" in host:
        return path.startswith("/post/") or path.startswith("/book/")
    if "dev.to" in host:
        blocked_paths = {"", "/", "/search", "/top/week", "/latest"}
        return path not in blocked_paths and path.count("/") >= 2
    if "stackoverflow.com" in host:
        return path.startswith("/questions/")
    if "github.com" in host:
        return path.count("/") >= 2 and not path.startswith("/search")
    if "hn.algolia.com" in host:
        return "story_" in query or "objectid" in query
    return True


def _matches_keyword(keyword: str, *values: str | None) -> bool:
    return any(keyword in (value or "").lower() for value in values)


def _candidate_rank(candidate: SourceCandidate) -> tuple[int, str]:
    url = candidate.url.lower()
    site = candidate.site or site_from_url(candidate.url) or ""
    if "github.com" in site:
        return (0, url)
    if "news.google.com" in site:
        return (1, url)
    if "/post/" in url or "/questions/" in url:
        return (2, url)
    if "search" in url or "hn.algolia.com" in site:
        return (4, url)
    return (3, url)


def _text(element: ElementTree.Element, tag: str) -> str | None:
    child = element.find(tag)
    if child is None or child.text is None:
        return None
    return child.text.strip()


def _namespaced_text(element: ElementTree.Element, tag: str) -> str | None:
    child = element.find(f"{{http://www.w3.org/2005/Atom}}{tag}")
    if child is None or child.text is None:
        return None
    return child.text.strip()


def _atom_link(element: ElementTree.Element) -> str | None:
    for link in element.findall("{http://www.w3.org/2005/Atom}link"):
        href = link.attrib.get("href")
        if href:
            return href
    return None


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
