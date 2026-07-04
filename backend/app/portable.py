from app.repositories import KnowledgeRepository
from app.schemas import (
    CardCreate,
    KnowledgeBaseCreate,
    KnowledgeEdgeCreate,
    KnowledgeExport,
    KnowledgeNodeCreate,
    LearningRunCreate,
    SourceCreate,
)


def export_knowledge(repository: KnowledgeRepository, knowledge_base_id: int | None = None) -> KnowledgeExport:
    nodes, edges = repository.list_graph(knowledge_base_id)
    knowledge_bases = repository.list_knowledge_bases()
    if knowledge_base_id is not None:
        knowledge_bases = [item for item in knowledge_bases if item.id == knowledge_base_id]
    return KnowledgeExport(
        knowledge_bases=knowledge_bases,
        runs=repository.list_runs(knowledge_base_id),
        sources=repository.list_all_sources(knowledge_base_id),
        cards=repository.list_all_cards(knowledge_base_id),
        nodes=nodes,
        edges=edges,
    )


def import_knowledge(repository: KnowledgeRepository, payload: KnowledgeExport) -> KnowledgeExport:
    default_base = repository.ensure_default_knowledge_base()
    knowledge_base_id_map: dict[int, int] = {}
    run_id_map: dict[int, int] = {}
    source_id_map: dict[int, int] = {}
    node_id_map: dict[int, int] = {}

    for knowledge_base in sorted(payload.knowledge_bases, key=lambda item: item.id):
        created = repository.create_knowledge_base(
            KnowledgeBaseCreate(name=knowledge_base.name, description=knowledge_base.description)
        )
        knowledge_base_id_map[knowledge_base.id] = created.id

    for run in sorted(payload.runs, key=lambda item: item.id):
        created = repository.create_run(
            LearningRunCreate(
                keyword=run.keyword,
                mode=_mode(run.mode),
                knowledge_base_id=knowledge_base_id_map.get(run.knowledge_base_id, default_base.id),
            )
        )
        repository.update_run_status(
            created,
            run.status,
            completed_at=run.completed_at,
            error_summary=run.error_summary,
        )
        repository.update_run_retention(created, run.is_pinned)
        run_id_map[run.id] = created.id

    for source in sorted(payload.sources, key=lambda item: item.id):
        new_run_id = run_id_map.get(source.run_id)
        if new_run_id is None:
            continue
        created = repository.add_source(
            SourceCreate(
                run_id=new_run_id,
                url=source.url,
                title=source.title,
                site=source.site,
                language=source.language,
                status=_source_status(source.status),
                status_reason=source.status_reason,
                snippet=source.snippet,
                extracted_text=source.extracted_text,
                content_hash=source.content_hash,
                quality_score=source.quality_score,
            )
        )
        repository.update_source_retention(created, source.is_pinned)
        source_id_map[source.id] = created.id

    for node in sorted(payload.nodes, key=lambda item: item.id):
        created = repository.upsert_node(
            KnowledgeNodeCreate(
                knowledge_base_id=knowledge_base_id_map.get(node.knowledge_base_id, default_base.id),
                type=node.type,
                name=node.name,
                summary=node.summary,
                aliases=node.aliases,
                tags=node.tags,
            )
        )
        node_id_map[node.id] = created.id

    for card in sorted(payload.cards, key=lambda item: item.id):
        new_run_id = run_id_map.get(card.run_id)
        if new_run_id is None:
            continue
        repository.add_card(
            CardCreate(
                run_id=new_run_id,
                type=card.type,
                title=card.title,
                summary=card.summary,
                details=card.details,
                source_ids=[source_id_map[item] for item in card.source_ids if item in source_id_map],
                node_ids=[node_id_map[item] for item in card.node_ids if item in node_id_map],
                sort_order=card.sort_order,
            )
        )

    for edge in sorted(payload.edges, key=lambda item: item.id):
        source_node_id = node_id_map.get(edge.source_node_id)
        target_node_id = node_id_map.get(edge.target_node_id)
        if source_node_id is None or target_node_id is None:
            continue
        repository.add_edge(
            KnowledgeEdgeCreate(
                knowledge_base_id=knowledge_base_id_map.get(edge.knowledge_base_id, default_base.id),
                source_node_id=source_node_id,
                target_node_id=target_node_id,
                type=edge.type,
                confidence=edge.confidence,
                evidence_source_ids=[source_id_map[item] for item in edge.evidence_source_ids if item in source_id_map],
            )
        )

    return export_knowledge(repository)


def _mode(value: str):
    if value in {"light", "standard", "deep"}:
        return value
    return "light"


def _source_status(value: str):
    if value in {"pending", "success", "partial", "failed", "skipped"}:
        return value
    return "partial"
