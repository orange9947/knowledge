from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.ai import AIOrchestrator, AIOutput, AIProviderError
from app.crawler import SourceCrawler
from app.discovery import SourceCandidate, discover_candidates, site_from_url
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
        configs = self.repository.ensure_default_source_configs()
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
        knowledge_base = self.repository.get_knowledge_base(run.knowledge_base_id)
        output = self.ai_orchestrator.generate(
            run.keyword,
            sources,
            model_config,
            knowledge_base.learning_prompt if knowledge_base else None,
            run.learning_prompt,
        )
        self._persist_ai_candidates(run.id, sources, output)
        return run

    def summarize_run(self, run_id: int):
        run = self.repository.get_run(run_id)
        if run is None:
            return None
        sources = self.repository.list_sources_for_run(run_id)
        history_cards = self.repository.list_all_cards(run.knowledge_base_id)
        history_nodes, _ = self.repository.list_graph(run.knowledge_base_id)
        model_config = self.repository.get_model_config()
        knowledge_base = self.repository.get_knowledge_base(run.knowledge_base_id)
        output = self.ai_orchestrator.summarize_run(
            run.keyword,
            sources,
            [card for card in history_cards if card.run_id != run.id],
            history_nodes,
            model_config,
            knowledge_base.learning_prompt if knowledge_base else None,
            run.learning_prompt,
        )
        self.repository.delete_cards_for_run_by_types(run.id, {"summary", "keyword_hint"}, approval_status="candidate")
        self._persist_ai_candidates(run.id, sources, output)
        return run

    def ai_collect_sources(self, run_id: int):
        run = self.repository.get_run(run_id)
        if run is None:
            return None
        self.repository.update_run_status(run, "running")
        history_cards = self.repository.list_all_cards(run.knowledge_base_id)
        history_nodes, _ = self.repository.list_graph(run.knowledge_base_id)
        model_config = self.repository.get_model_config()
        knowledge_base = self.repository.get_knowledge_base(run.knowledge_base_id)
        try:
            targets = self.ai_orchestrator.suggest_collection_targets(
                run.keyword,
                [card for card in history_cards if card.run_id != run.id],
                history_nodes,
                model_config,
                knowledge_base.learning_prompt if knowledge_base else None,
                run.learning_prompt,
            )
        except AIProviderError as exc:
            self.repository.update_run_status(
                run,
                "failed",
                completed_at=datetime.now(timezone.utc),
                error_summary=str(exc),
            )
            raise
        if not targets:
            self.repository.update_run_status(
                run,
                "partial",
                completed_at=datetime.now(timezone.utc),
                error_summary="AI 没有返回可采集的具体网页。",
            )
            return run

        existing_urls = {source.url for source in self.repository.list_sources_for_run(run.id)}
        statuses: list[str] = []
        for target in targets:
            if target.url in existing_urls:
                continue
            candidate = SourceCandidate(
                url=target.url,
                title=target.title,
                site=site_from_url(target.url),
                snippet=target.reason,
            )
            source_payload = self.crawler.crawl(run.id, candidate)
            statuses.append(source_payload.status)
            self.repository.add_source(source_payload)

        if any(status == "success" for status in statuses):
            final_status = "completed" if all(status == "success" for status in statuses) else "partial"
            error_summary = None if final_status == "completed" else "AI 采集的部分网页抓取失败或质量偏低。"
        else:
            final_status = "failed"
            error_summary = "AI 采集没有成功提取正文。"
        self.repository.update_run_status(
            run,
            final_status,
            completed_at=datetime.now(timezone.utc),
            error_summary=error_summary,
        )
        if final_status in {"completed", "partial"}:
            try:
                self.summarize_run(run.id)
            except AIProviderError as exc:
                self.repository.update_run_status(
                    run,
                    "failed",
                    completed_at=datetime.now(timezone.utc),
                    error_summary=str(exc),
                )
                raise
        return run

    def approve_cards(self, run_id: int, card_ids: list[int]):
        run = self.repository.get_run(run_id)
        if run is None:
            return None
        cards = self.repository.list_cards_for_run(run_id)
        selected_ids = set(card_ids)
        selected_cards = [card for card in cards if card.id in selected_ids]
        if not selected_cards:
            raise ValueError("请选择要加入图谱的知识卡片")
        for card in selected_cards:
            node_ids = self._approve_card(run.knowledge_base_id, card)
            self.repository.update_card_approval(card, node_ids)
        return run

    def _persist_ai_candidates(self, run_id: int, sources, output: AIOutput) -> None:
        existing_sort_orders = [card.sort_order for card in self.repository.list_cards_for_run(run_id)]
        next_sort_order = max(existing_sort_orders, default=-1) + 1
        for offset, card_payload in enumerate(output.cards):
            source_ids = _source_ids_from_indexes(sources, card_payload.source_indexes)
            self.repository.add_card(
                CardCreate(
                    run_id=run_id,
                    type=card_payload.type,
                    title=card_payload.title,
                    summary=card_payload.summary,
                    details=card_payload.details,
                    source_ids=source_ids,
                    node_ids=[],
                    sort_order=next_sort_order + offset,
                    approval_status="candidate",
                    candidate_payload=_candidate_payload_for_card(card_payload, output, sources),
                )
            )

    def _approve_card(self, knowledge_base_id: int, card) -> list[int]:
        payload = card.candidate_payload or {}
        nodes = payload.get("nodes") or []
        edges = payload.get("edges") or []
        node_by_name = {}
        for node_payload in nodes:
            name = str(node_payload.get("name") or "").strip()
            if not name:
                continue
            node = self.repository.upsert_node(
                KnowledgeNodeCreate(
                    knowledge_base_id=knowledge_base_id,
                    type=str(node_payload.get("type") or "concept"),
                    name=name,
                    summary=node_payload.get("summary"),
                    aliases=list(node_payload.get("aliases") or []),
                    tags=list(node_payload.get("tags") or []),
                )
            )
            node_by_name[name] = node
        if not node_by_name:
            node = self.repository.upsert_node(
                KnowledgeNodeCreate(
                    knowledge_base_id=knowledge_base_id,
                    type=_node_type_for_card(card.type),
                    name=card.title,
                    summary=card.summary,
                    tags=[card.type],
                )
            )
            node_by_name[card.title] = node
        for edge_payload in edges:
            source_node = node_by_name.get(str(edge_payload.get("source") or ""))
            target_node = node_by_name.get(str(edge_payload.get("target") or ""))
            if source_node is None or target_node is None:
                continue
            confidence = edge_payload.get("confidence", 0.5)
            self.repository.add_edge(
                KnowledgeEdgeCreate(
                    knowledge_base_id=knowledge_base_id,
                    source_node_id=source_node.id,
                    target_node_id=target_node.id,
                    type=str(edge_payload.get("type") or "related"),
                    confidence=confidence if isinstance(confidence, int | float) else 0.5,
                    evidence_source_ids=list(edge_payload.get("evidence_source_ids") or card.source_ids or []),
                )
            )
        return _card_node_ids_for_payload(card.title, node_by_name) or [node.id for node in node_by_name.values()]


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


def _candidate_payload_for_card(card_payload, output: AIOutput, sources) -> dict:
    card_source_ids = _source_ids_from_indexes(sources, card_payload.source_indexes)
    output_nodes = {node.name: node for node in output.nodes}
    seed_names: set[str] = set()
    for node in output.nodes:
        if _node_matches_card(card_payload, node):
            seed_names.add(node.name)
    if not seed_names:
        seed_names.update(node.name for node in output.nodes if node.type == "keyword")

    related_edges = []
    endpoint_names = set(seed_names)
    for edge in output.edges:
        if edge.source in seed_names or edge.target in seed_names:
            endpoint_names.add(edge.source)
            endpoint_names.add(edge.target)
            edge_data = edge.model_dump()
            edge_data["evidence_source_ids"] = _source_ids_from_indexes(sources, edge.source_indexes) or card_source_ids
            related_edges.append(edge_data)

    related_nodes = [output_nodes[name].model_dump() for name in endpoint_names if name in output_nodes]
    if not any(node["name"] == card_payload.title for node in related_nodes):
        related_nodes.append(
            {
                "type": _node_type_for_card(card_payload.type),
                "name": card_payload.title,
                "summary": card_payload.summary,
                "aliases": [],
                "tags": [card_payload.type],
            }
        )

    return {"nodes": related_nodes, "edges": related_edges}


def _node_matches_card(card_payload, node) -> bool:
    title = card_payload.title.strip()
    if not title:
        return False
    return (
        node.name == title
        or title.startswith(node.name)
        or node.name.startswith(title)
        or card_payload.type in (node.tags or [])
    )


def _node_type_for_card(card_type: str) -> str:
    if card_type in {"usage_method"}:
        return "skill"
    if card_type in {"practice_project"}:
        return "project"
    if card_type in {"recommended_reading", "summary", "keyword_hint", "key_point", "learning_path"}:
        return "concept"
    return "concept"
