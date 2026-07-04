from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import init_db
from app.portable import export_knowledge, import_knowledge
from app.repositories import KnowledgeRepository
from app.schemas import (
    CardCreate,
    KnowledgeBaseCreate,
    KnowledgeEdgeCreate,
    KnowledgeNodeCreate,
    LearningRunCreate,
    SourceCreate,
)


def build_repository(path):
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    return KnowledgeRepository(session), session


def test_export_import_round_trip_excludes_model_secrets(tmp_path):
    source_repo, source_session = build_repository(tmp_path / "source.db")
    target_repo, target_session = build_repository(tmp_path / "target.db")
    try:
        knowledge_base = source_repo.create_knowledge_base(KnowledgeBaseCreate(name="LLM"))
        run = source_repo.create_run(
            LearningRunCreate(keyword="RAG", mode="light", knowledge_base_id=knowledge_base.id)
        )
        source = source_repo.add_source(
            SourceCreate(
                run_id=run.id,
                url="https://example.com/rag",
                title="RAG guide",
                status="success",
                extracted_text="RAG material",
            )
        )
        node = source_repo.upsert_node(
            KnowledgeNodeCreate(knowledge_base_id=knowledge_base.id, type="keyword", name="RAG")
        )
        other = source_repo.upsert_node(
            KnowledgeNodeCreate(knowledge_base_id=knowledge_base.id, type="concept", name="Retrieval")
        )
        edge = source_repo.add_edge(
            KnowledgeEdgeCreate(
                knowledge_base_id=knowledge_base.id,
                source_node_id=node.id,
                target_node_id=other.id,
                type="contains",
                evidence_source_ids=[source.id],
            )
        )
        source_repo.add_card(
            CardCreate(
                run_id=run.id,
                type="foundation",
                title="RAG",
                summary="Retrieval augmented generation",
                source_ids=[source.id],
                node_ids=[node.id],
            )
        )

        exported = export_knowledge(source_repo, knowledge_base_id=knowledge_base.id)
        serialized = exported.model_dump_json()
        assert "api_key" not in serialized
        assert [item.name for item in exported.knowledge_bases] == ["LLM"]
        assert len(exported.runs) == 1
        assert len(exported.sources) == 1
        assert len(exported.cards) == 1
        assert len(exported.nodes) == 2
        assert exported.edges[0].id == edge.id

        imported = import_knowledge(target_repo, exported)
        assert len(imported.runs) == 1
        assert len(imported.sources) == 1
        assert len(imported.cards) == 1
        assert len(imported.nodes) == 2
        assert len(imported.edges) == 1
        assert any(item.name == "LLM" for item in imported.knowledge_bases)
    finally:
        source_session.close()
        target_session.close()
