from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app import models
from app.ai import AIOrchestrator, AIOutput, Material
from app.crawler import SourceCrawler
from app.discovery import discover_candidates
from app.repositories import KnowledgeRepository
from app.schemas import (
    AssistantCandidateCard,
    AssistantQueryRequest,
    AssistantQueryResponse,
    AssistantReference,
    CardCreate,
    LearningRunCreate,
    SourceCreate,
)
from app.services import _candidate_payload_for_card, _source_ids_from_indexes


WEB_SOURCE_LIMIT = 4


@dataclass(frozen=True)
class GraphAssistantContext:
    text: str
    graph_references: list[AssistantReference]
    selected_node: models.KnowledgeNode | None


class GraphAssistantService:
    def __init__(
        self,
        session: Session,
        crawler: SourceCrawler | None = None,
        ai_orchestrator: AIOrchestrator | None = None,
    ):
        self.repository = KnowledgeRepository(session)
        self.crawler = crawler or SourceCrawler()
        self.ai_orchestrator = ai_orchestrator or AIOrchestrator(secret_store=self.repository.secret_store)

    def answer(self, payload: AssistantQueryRequest) -> AssistantQueryResponse:
        knowledge_base = self.repository.get_knowledge_base(payload.knowledge_base_id)
        if knowledge_base is None:
            raise ValueError("知识库不存在")
        if payload.selected_node_id is not None:
            selected_node = self.repository.get_node(payload.selected_node_id)
            if selected_node is None or selected_node.knowledge_base_id != payload.knowledge_base_id:
                raise ValueError("节点不存在")
        else:
            selected_node = None

        context = self._build_graph_context(payload.knowledge_base_id, selected_node)
        web_source_payloads: list[SourceCreate] = []
        web_materials: list[Material] = []
        warnings: list[str] = []
        if payload.allow_web:
            web_source_payloads, web_materials, web_warnings = self._collect_web_materials(payload)
            warnings.extend(web_warnings)

        output = self.ai_orchestrator.answer_graph_question(
            payload.question,
            context.text,
            web_materials,
            self.repository.get_model_config(),
            knowledge_base.learning_prompt,
            selected_node.name if selected_node else None,
            payload.create_candidates,
        )

        run = None
        candidate_cards: list[models.Card] = []
        if payload.create_candidates and output.cards:
            run = self._persist_candidates(payload, output, web_source_payloads)
            candidate_cards = self.repository.list_cards_for_run(run.id)

        graph_references = _merge_references(context.graph_references, _assistant_references(output.graph_references, "graph"))
        web_references = _source_references(web_source_payloads) or _assistant_references(output.web_references, "web")
        return AssistantQueryResponse(
            answer=output.answer,
            used_web=bool(web_source_payloads),
            run_id=run.id if run else None,
            graph_references=graph_references,
            web_references=web_references,
            candidate_cards=[_candidate_card_response(card) for card in candidate_cards],
            warnings=[*warnings, *output.warnings],
        )

    def _build_graph_context(
        self,
        knowledge_base_id: int,
        selected_node: models.KnowledgeNode | None,
    ) -> GraphAssistantContext:
        nodes, edges = self.repository.list_graph(knowledge_base_id)
        cards = self.repository.list_all_cards(knowledge_base_id)
        sources = self.repository.list_all_sources(knowledge_base_id)
        source_by_id = {source.id: source for source in sources}
        node_by_id = {node.id: node for node in nodes}
        related_node_ids = _related_node_ids(selected_node.id, edges, depth=2) if selected_node else set()
        if selected_node:
            related_node_ids.add(selected_node.id)
        ranked_nodes = sorted(
            nodes,
            key=lambda node: (
                0 if selected_node and node.id == selected_node.id else 1 if node.id in related_node_ids else 2,
                -_node_degree(node.id, edges),
                node.id,
            ),
        )
        ranked_edges = [
            edge
            for edge in edges
            if not related_node_ids or edge.source_node_id in related_node_ids or edge.target_node_id in related_node_ids
        ][:40]
        ranked_cards = sorted(
            cards,
            key=lambda card: (
                0 if set(card.node_ids or []) & related_node_ids else 1,
                -card.id,
            ),
        )

        lines = ["节点："]
        references: list[AssistantReference] = []
        for node in ranked_nodes[:30]:
            lines.append(
                f"- [node:{node.id}] {node.name}（{node.type}）：{(node.summary or '暂无摘要')[:220]}；标签：{', '.join(node.tags or [])}"
            )
            if len(references) < 12:
                references.append(
                    AssistantReference(
                        kind="graph",
                        title=node.name,
                        summary=node.summary,
                        node_id=node.id,
                    )
                )

        lines.append("关系：")
        for edge in ranked_edges:
            source = node_by_id.get(edge.source_node_id)
            target = node_by_id.get(edge.target_node_id)
            if source is None or target is None:
                continue
            lines.append(f"- {source.name} --{edge.type}/{edge.confidence:.2f}--> {target.name}")

        lines.append("已批准知识卡片：")
        for card in [item for item in ranked_cards if item.approval_status == "approved"][:20]:
            evidence_titles = []
            for source_id in card.source_ids or []:
                source = source_by_id.get(source_id)
                if source:
                    evidence_titles.append(source.title or source.site or source.url)
            evidence = f"；来源：{'、'.join(evidence_titles[:3])}" if evidence_titles else ""
            lines.append(f"- [card:{card.id}] {card.title}：{card.summary[:260]}{evidence}")

        return GraphAssistantContext(
            text="\n".join(lines) if nodes or cards else "当前知识库暂无图谱内容。",
            graph_references=references,
            selected_node=selected_node,
        )

    def _collect_web_materials(
        self,
        payload: AssistantQueryRequest,
    ) -> tuple[list[SourceCreate], list[Material], list[str]]:
        warnings: list[str] = []
        candidates = discover_candidates(payload.question, self.repository.ensure_default_source_configs(), "light")
        web_sources: list[SourceCreate] = []
        for candidate in candidates[:WEB_SOURCE_LIMIT]:
            source_payload = self.crawler.crawl(0, candidate)
            if source_payload.status in {"success", "partial"} and (source_payload.extracted_text or source_payload.snippet):
                web_sources.append(source_payload)
        if not web_sources:
            warnings.append("联网补充没有提取到可用正文，回答主要基于当前图谱。")
        return web_sources, _source_materials_for_assistant(web_sources), warnings

    def _persist_candidates(
        self,
        payload: AssistantQueryRequest,
        output,
        web_sources: list[SourceCreate],
    ) -> models.LearningRun:
        run = self.repository.create_run(
            LearningRunCreate(
                keyword=f"AI助手：{payload.question[:100]}",
                mode="light",
                knowledge_base_id=payload.knowledge_base_id,
            )
        )
        self.repository.update_run_status(run, "completed", completed_at=datetime.now(timezone.utc))
        sources: list[models.Source] = []
        for source in web_sources:
            source.run_id = run.id
            sources.append(self.repository.add_source(source))
        ai_output = AIOutput(cards=output.cards, nodes=output.nodes, edges=output.edges)
        for sort_order, card_payload in enumerate(output.cards):
            source_ids = _source_ids_from_indexes(sources, card_payload.source_indexes)
            self.repository.add_card(
                CardCreate(
                    run_id=run.id,
                    type=card_payload.type,
                    title=card_payload.title,
                    summary=card_payload.summary,
                    details=card_payload.details,
                    source_ids=source_ids,
                    node_ids=[],
                    sort_order=sort_order,
                    approval_status="candidate",
                    candidate_payload=_candidate_payload_for_card(card_payload, ai_output, sources),
                )
            )
        return run


def _related_node_ids(node_id: int, edges: list[models.KnowledgeEdge], depth: int) -> set[int]:
    adjacency: dict[int, set[int]] = {}
    for edge in edges:
        adjacency.setdefault(edge.source_node_id, set()).add(edge.target_node_id)
        adjacency.setdefault(edge.target_node_id, set()).add(edge.source_node_id)
    visited = {node_id}
    frontier = {node_id}
    for _ in range(depth):
        next_frontier: set[int] = set()
        for current in frontier:
            next_frontier.update(adjacency.get(current, set()) - visited)
        if not next_frontier:
            break
        visited.update(next_frontier)
        frontier = next_frontier
    return visited


def _node_degree(node_id: int, edges: list[models.KnowledgeEdge]) -> int:
    return sum(1 for edge in edges if edge.source_node_id == node_id or edge.target_node_id == node_id)


def _source_materials_for_assistant(sources: list[SourceCreate]) -> list[Material]:
    materials: list[Material] = []
    for source in sources:
        text = source.extracted_text or source.snippet
        if not text:
            continue
        materials.append(
            Material(
                title=source.title or source.site or source.url,
                url=source.url,
                site=source.site,
                text=text[:4000],
            )
        )
    return materials


def _source_references(sources: list[SourceCreate]) -> list[AssistantReference]:
    return [
        AssistantReference(
            kind="web",
            title=source.title or source.site or source.url,
            summary=source.snippet,
            source_id=None,
            url=source.url,
        )
        for source in sources
    ]


def _assistant_references(references, kind: str) -> list[AssistantReference]:
    parsed: list[AssistantReference] = []
    for reference in references:
        node_id = _ref_int(reference.ref_id, "node:")
        source_id = _ref_int(reference.ref_id, "source:")
        parsed.append(
            AssistantReference(
                kind=kind,
                title=reference.title,
                summary=reference.summary,
                node_id=node_id,
                source_id=source_id,
                url=reference.url,
            )
        )
    return parsed


def _merge_references(*reference_groups: list[AssistantReference]) -> list[AssistantReference]:
    merged: list[AssistantReference] = []
    seen: set[tuple[str, int | None, int | None, str | None]] = set()
    for references in reference_groups:
        for reference in references:
            key = (reference.title, reference.node_id, reference.source_id, reference.url)
            if key in seen:
                continue
            seen.add(key)
            merged.append(reference)
    return merged[:16]


def _candidate_card_response(card: models.Card) -> AssistantCandidateCard:
    return AssistantCandidateCard(
        id=card.id,
        run_id=card.run_id,
        type=card.type,
        title=card.title,
        summary=card.summary,
        details=card.details,
        source_ids=card.source_ids or [],
        approval_status=card.approval_status,
    )


def _ref_int(value: str | None, prefix: str) -> int | None:
    if not value or not value.startswith(prefix):
        return None
    try:
        return int(value[len(prefix):])
    except ValueError:
        return None
