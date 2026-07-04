from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import init_db
from app.repositories import KnowledgeRepository, normalize_name
from app.schemas import (
    CardCreate,
    KnowledgeBaseCreate,
    KnowledgeEdgeCreate,
    KnowledgeNodeCreate,
    LearningRunCreate,
    SourceCreate,
)


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
        knowledge_base_id = run.knowledge_base_id
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
                knowledge_base_id=knowledge_base_id,
                type="concept",
                name="AI Agent",
                summary="Autonomous AI workflow concept.",
                aliases=["Agentic AI"],
                tags=["ai", "workflow"],
            )
        )
        skill = repository.upsert_node(
            KnowledgeNodeCreate(
                knowledge_base_id=knowledge_base_id,
                type="skill",
                name="Tool calling",
                tags=["practice"],
            )
        )
        edge = repository.add_edge(
            KnowledgeEdgeCreate(
                knowledge_base_id=knowledge_base_id,
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
        knowledge_base = repository.ensure_default_knowledge_base()
        first = repository.upsert_node(
            KnowledgeNodeCreate(
                knowledge_base_id=knowledge_base.id,
                type="concept",
                name="RAG",
                aliases=["Retrieval Augmented Generation"],
                tags=["llm"],
            )
        )
        second = repository.upsert_node(
            KnowledgeNodeCreate(
                knowledge_base_id=knowledge_base.id,
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


def test_nodes_are_deduplicated_inside_each_knowledge_base(tmp_path):
    repository, session = build_test_repository(tmp_path)
    try:
        default_base = repository.ensure_default_knowledge_base()
        separate_base = repository.create_knowledge_base(KnowledgeBaseCreate(name="Computer Vision"))

        default_node = repository.upsert_node(
            KnowledgeNodeCreate(knowledge_base_id=default_base.id, type="concept", name="RAG")
        )
        repeated_default_node = repository.upsert_node(
            KnowledgeNodeCreate(knowledge_base_id=default_base.id, type="concept", name=" rag ")
        )
        separate_node = repository.upsert_node(
            KnowledgeNodeCreate(knowledge_base_id=separate_base.id, type="concept", name="RAG")
        )

        assert default_node.id == repeated_default_node.id
        assert separate_node.id != default_node.id
        default_nodes, _ = repository.list_graph(default_base.id)
        separate_nodes, _ = repository.list_graph(separate_base.id)
        assert [node.id for node in default_nodes] == [default_node.id]
        assert [node.id for node in separate_nodes] == [separate_node.id]
    finally:
        session.close()
