from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.ai import AIOrchestrator, AIOutput
from app.crawler import SourceCrawler
from app.discovery import discover_candidates
from app.repositories import KnowledgeRepository
from app.schemas import CardCreate, KnowledgeEdgeCreate, KnowledgeNodeCreate


class LearningRunService:
    def __init__(
        self,
        session: Session,
        crawler: SourceCrawler | None = None,
        ai_orchestrator: AIOrchestrator | None = None,
    ):
        self.session = session
        self.repository = KnowledgeRepository(session)
        self.crawler = crawler or SourceCrawler()
        self.ai_orchestrator = ai_orchestrator or AIOrchestrator()

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
                error_summary="没有发现可用来源候选。请添加 RSS、入口链接或来源配置。",
            )
            return run

        statuses: list[str] = []
        for candidate in candidates:
            source_payload = self.crawler.crawl(run.id, candidate)
            statuses.append(source_payload.status)
            self.repository.add_source(source_payload)

        if any(status == "success" for status in statuses):
            final_status = "completed" if all(status == "success" for status in statuses) else "partial"
            error_summary = None if final_status == "completed" else "部分来源抓取失败或只提取到部分内容。"
        else:
            final_status = "failed"
            error_summary = "没有来源成功提取内容。"
        self.repository.update_run_status(
            run,
            final_status,
            completed_at=datetime.now(timezone.utc),
            error_summary=error_summary,
        )
        if final_status in {"completed", "partial"}:
            self.generate_learning_output(run.id)
        return run

    def generate_learning_output(self, run_id: int):
        run = self.repository.get_run(run_id)
        if run is None:
            return None
        sources = self.repository.list_sources_for_run(run_id)
        model_config = self.repository.get_model_config()
        output = self.ai_orchestrator.generate(run.keyword, sources, model_config)
        self._persist_ai_output(run.id, run.knowledge_base_id, sources, output)
        return run

    def _persist_ai_output(self, run_id: int, knowledge_base_id: int, sources, output: AIOutput) -> None:
        node_by_name = {}
        for node_payload in output.nodes:
            node = self.repository.upsert_node(
                KnowledgeNodeCreate(
                    knowledge_base_id=knowledge_base_id,
                    type=node_payload.type,
                    name=node_payload.name,
                    summary=node_payload.summary,
                    aliases=node_payload.aliases,
                    tags=node_payload.tags,
                )
            )
            node_by_name[node_payload.name] = node

        for sort_order, card_payload in enumerate(output.cards):
            source_ids = _source_ids_from_indexes(sources, card_payload.source_indexes)
            card_nodes = _card_node_ids_for_payload(card_payload.title, node_by_name)
            self.repository.add_card(
                CardCreate(
                    run_id=run_id,
                    type=card_payload.type,
                    title=card_payload.title,
                    summary=card_payload.summary,
                    details=card_payload.details,
                    source_ids=source_ids,
                    node_ids=card_nodes,
                    sort_order=sort_order,
                )
            )

        for edge_payload in output.edges:
            source_node = node_by_name.get(edge_payload.source)
            target_node = node_by_name.get(edge_payload.target)
            if source_node is None or target_node is None:
                continue
            self.repository.add_edge(
                KnowledgeEdgeCreate(
                    knowledge_base_id=knowledge_base_id,
                    source_node_id=source_node.id,
                    target_node_id=target_node.id,
                    type=edge_payload.type,
                    confidence=edge_payload.confidence,
                    evidence_source_ids=_source_ids_from_indexes(sources, edge_payload.source_indexes),
                )
            )


def _source_ids_from_indexes(sources, indexes: list[int]) -> list[int]:
    ids: list[int] = []
    for index in indexes:
        if 0 <= index < len(sources):
            ids.append(sources[index].id)
    return ids


def _card_node_ids_for_payload(card_title: str, node_by_name) -> list[int]:
    normalized_title = card_title.strip()
    node_ids: list[int] = []
    for node in node_by_name.values():
        if node.name == normalized_title:
            node_ids.append(node.id)
            continue
        if normalized_title.startswith(node.name) or node.name.startswith(normalized_title):
            node_ids.append(node.id)
    return node_ids
