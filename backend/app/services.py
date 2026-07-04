from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.crawler import SourceCrawler
from app.discovery import discover_candidates
from app.repositories import KnowledgeRepository


class LearningRunService:
    def __init__(self, session: Session, crawler: SourceCrawler | None = None):
        self.session = session
        self.repository = KnowledgeRepository(session)
        self.crawler = crawler or SourceCrawler()

    def collect_sources(self, run_id: int):
        run = self.repository.get_run(run_id)
        if run is None:
            return None

        self.repository.update_run_status(run, "running")
        configs = self.repository.list_source_configs()
        candidates = discover_candidates(run.keyword, configs, run.mode)
        if not candidates:
            self.repository.update_run_status(
                run,
                "partial",
                completed_at=datetime.now(timezone.utc),
                error_summary="No source candidates discovered. Add RSS feeds, entry URLs, or source configs.",
            )
            return run

        statuses: list[str] = []
        for candidate in candidates:
            source_payload = self.crawler.crawl(run.id, candidate)
            statuses.append(source_payload.status)
            self.repository.add_source(source_payload)

        if any(status == "success" for status in statuses):
            final_status = "completed" if all(status == "success" for status in statuses) else "partial"
            error_summary = None if final_status == "completed" else "Some sources failed or only partially extracted."
        else:
            final_status = "failed"
            error_summary = "No sources could be extracted successfully."
        self.repository.update_run_status(
            run,
            final_status,
            completed_at=datetime.now(timezone.utc),
            error_summary=error_summary,
        )
        return run
