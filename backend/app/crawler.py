import hashlib
import re
from html.parser import HTMLParser

import httpx

from app.discovery import SourceCandidate, site_from_url
from app.schemas import SourceCreate


class BodyTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_stack: list[str] = []
        self._title_open = False
        self.title: str | None = None
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"script", "style", "noscript", "svg", "head"}:
            self._skip_stack.append(tag)
        if tag == "title":
            self._title_open = True
        if tag in {"p", "br", "li", "h1", "h2", "h3", "article", "section"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_stack and self._skip_stack[-1] == tag:
            self._skip_stack.pop()
        if tag == "title":
            self._title_open = False
        if tag in {"p", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._title_open:
            self.title = text
            return
        if self._skip_stack:
            return
        self.parts.append(text)

    def body_text(self) -> str:
        raw = " ".join(self.parts)
        raw = re.sub(r"\s+", " ", raw)
        return raw.strip()


class SourceCrawler:
    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout

    def crawl(self, run_id: int, candidate: SourceCandidate) -> SourceCreate:
        try:
            with httpx.Client(follow_redirects=True, timeout=self.timeout) as client:
                response = client.get(
                    candidate.url,
                    headers={"User-Agent": "AILearningKnowledgeGraph/0.1"},
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            return self._failed(run_id, candidate, f"http_status_{exc.response.status_code}")
        except httpx.TimeoutException:
            return self._failed(run_id, candidate, "timeout")
        except httpx.HTTPError as exc:
            return self._failed(run_id, candidate, exc.__class__.__name__)

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type and content_type:
            return self._partial(
                run_id,
                candidate,
                f"unsupported_content_type:{content_type.split(';')[0]}",
                response.text[:500],
            )

        parser = BodyTextParser()
        parser.feed(response.text)
        extracted_text = parser.body_text()
        title = candidate.title or parser.title
        if not extracted_text:
            return self._partial(run_id, candidate, "empty_extraction", response.text[:500], title=title)

        return SourceCreate(
            run_id=run_id,
            url=candidate.url,
            title=title,
            site=candidate.site or site_from_url(candidate.url),
            language=candidate.language,
            status="success",
            status_reason=None,
            snippet=candidate.snippet,
            extracted_text=extracted_text[:20000],
            content_hash=_hash_text(extracted_text),
            quality_score=_quality_score(extracted_text),
        )

    def _failed(self, run_id: int, candidate: SourceCandidate, reason: str) -> SourceCreate:
        return SourceCreate(
            run_id=run_id,
            url=candidate.url,
            title=candidate.title,
            site=candidate.site or site_from_url(candidate.url),
            language=candidate.language,
            status="failed",
            status_reason=reason,
            snippet=candidate.snippet,
        )

    def _partial(
        self,
        run_id: int,
        candidate: SourceCandidate,
        reason: str,
        text: str | None,
        title: str | None = None,
    ) -> SourceCreate:
        return SourceCreate(
            run_id=run_id,
            url=candidate.url,
            title=title or candidate.title,
            site=candidate.site or site_from_url(candidate.url),
            language=candidate.language,
            status="partial",
            status_reason=reason,
            snippet=candidate.snippet,
            extracted_text=text,
            content_hash=_hash_text(text) if text else None,
            quality_score=_quality_score(text or ""),
        )


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _quality_score(value: str) -> float:
    length = len(value.strip())
    if length >= 2000:
        return 1.0
    if length >= 800:
        return 0.8
    if length >= 300:
        return 0.55
    if length > 0:
        return 0.25
    return 0.0
