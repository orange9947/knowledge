from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import init_db
from app.repositories import KnowledgeRepository, normalize_name
from app.schemas import CardCreate, KnowledgeEdgeCreate, KnowledgeNodeCreate, LearningRunCreate, SourceCreate


def build_test_repository(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    return KnowledgeRepository(session), session


def test_normalize_name_collapses_case_and_spacing():
    assert normalize_name("  AI   Agent  ") == "ai agent"


def test_repository_persists_run_source_card_and_graph(tmp_path):
    repository, session = build_test_repository(tmp_path)
    try:
        run = repository.create_run(LearningRunCreate(keyword="AI Agent"))
        source = repository.add_source(
            SourceCreate(
                run_id=run.id,
                url="https://example.com/agents",
                title="Agent Systems",
                status="success",
                extracted_text="Agent orchestration material.",
            )
        )
        concept = repository.upsert_node(
            KnowledgeNodeCreate(
                type="concept",
                name="AI Agent",
                summary="Autonomous AI workflow concept.",
                aliases=["Agentic AI"],
                tags=["ai", "workflow"],
            )
        )
        skill = repository.upsert_node(
            KnowledgeNodeCreate(type="skill", name="Tool calling", tags=["practice"])
        )
        edge = repository.add_edge(
            KnowledgeEdgeCreate(
                source_node_id=concept.id,
                target_node_id=skill.id,
                type="contains",
                confidence=0.8,
                evidence_source_ids=[source.id],
            )
        )
        card = repository.add_card(
            CardCreate(
                run_id=run.id,
                type="foundation",
                title="AI Agent",
                summary="A system that can plan and use tools.",
                source_ids=[source.id],
                node_ids=[concept.id],
            )
        )

        session.refresh(run)
        assert run.source_count == 1
        assert source.status == "success"
        assert concept.normalized_name == "ai agent"
        assert edge.confidence == 0.8
        assert card.source_ids == [source.id]
    finally:
        session.close()


def test_upsert_node_merges_aliases_and_tags(tmp_path):
    repository, session = build_test_repository(tmp_path)
    try:
        first = repository.upsert_node(
            KnowledgeNodeCreate(
                type="concept",
                name="RAG",
                aliases=["Retrieval Augmented Generation"],
                tags=["llm"],
            )
        )
        second = repository.upsert_node(
            KnowledgeNodeCreate(
                type="concept",
                name=" rag ",
                aliases=["retrieval augmented generation", "检索增强生成"],
                tags=["LLM", "search"],
            )
        )

        assert first.id == second.id
        assert second.aliases == ["Retrieval Augmented Generation", "检索增强生成"]
        assert second.tags == ["llm", "search"]
    finally:
        session.close()
