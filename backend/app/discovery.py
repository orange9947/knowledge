from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse
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
            candidates.extend(_domain_candidates(config))
        elif config.type == "builtin":
            candidates.extend(_builtin_candidates(keyword, config))
        elif config.type == "rss":
            candidates.extend(_rss_candidates(keyword, config, fetcher))
        elif config.type == "search_page":
            candidates.extend(_search_page_candidates(keyword, config))
    return dedupe_candidates(candidates)[: mode_limit(mode)]


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


def _domain_candidates(config: models.SourceConfig) -> list[SourceCandidate]:
    if is_http_url(config.url_or_domain):
        return _entry_url_candidates(config)
    return []


def _builtin_candidates(keyword: str, config: models.SourceConfig) -> list[SourceCandidate]:
    marker = f"{config.name} {config.url_or_domain or ''}".lower()
    if "github" not in marker:
        return []
    url = f"https://github.com/search?q={quote_plus(keyword)}&type=repositories"
    return [
        SourceCandidate(
            url=url,
            title=f"GitHub repositories for {keyword}",
            site="github.com",
            language=config.language_hint or "en",
            snippet="Repository search results generated from the configured GitHub built-in source.",
        )
    ]


def _rss_candidates(
    keyword: str,
    config: models.SourceConfig,
    fetch_text: Callable[[str], str],
) -> list[SourceCandidate]:
    if not is_http_url(config.url_or_domain):
        return []
    feed_url = config.url_or_domain or ""
    try:
        feed_xml = fetch_text(feed_url)
    except httpx.HTTPError:
        return []
    return parse_feed_entries(feed_xml, keyword, feed_url, config.language_hint)


def _search_page_candidates(keyword: str, config: models.SourceConfig) -> list[SourceCandidate]:
    if not config.enabled or not is_http_url(config.url_or_domain):
        return []
    url = (config.url_or_domain or "").replace("{keyword}", quote_plus(keyword))
    return [
        SourceCandidate(
            url=url,
            title=f"Search page for {keyword}",
            site=site_from_url(url),
            language=config.language_hint,
            snippet="Experimental search-page source.",
        )
    ]


def _matches_keyword(keyword: str, *values: str | None) -> bool:
    return any(keyword in (value or "").lower() for value in values)


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
