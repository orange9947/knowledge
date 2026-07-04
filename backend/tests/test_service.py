from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import init_db
from app.discovery import SourceCandidate
from app.repositories import KnowledgeRepository
from app.schemas import LearningRunCreate, SourceConfigWrite, SourceCreate
from app.services import LearningRunService


class FakeCrawler:
    def crawl(self, run_id: int, candidate: SourceCandidate) -> SourceCreate:
        return SourceCreate(
            run_id=run_id,
            url=candidate.url,
            title=candidate.title,
            site=candidate.site,
            status="success",
            extracted_text="AI Agent source body " * 20,
            content_hash="hash",
            quality_score=0.8,
        )


def test_collect_sources_updates_run_and_persists_sources(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'service.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        repository = KnowledgeRepository(session)
        repository.replace_source_configs(
            [
                SourceConfigWrite(
                    name="Docs",
                    type="entry_url",
                    enabled=True,
                    url_or_domain="https://docs.example.com/ai-agent",
                )
            ]
        )
        run = repository.create_run(LearningRunCreate(keyword="AI Agent", mode="light"))

        updated = LearningRunService(session, crawler=FakeCrawler()).collect_sources(run.id)

        assert updated is not None
        assert updated.status == "completed"
        sources = repository.list_sources_for_run(run.id)
        assert len(sources) == 1
        assert sources[0].status == "success"
        cards = repository.list_cards_for_run(run.id)
        assert [card.type for card in cards] == ["foundation", "current_practice", "learning_path"]
        nodes, edges = repository.list_graph()
        assert len(nodes) >= 3
        assert len(edges) >= 2
    finally:
        session.close()
