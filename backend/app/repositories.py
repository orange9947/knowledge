import re
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.defaults import default_source_configs
from app.schemas import (
    CardCreate,
    KnowledgeEdgeCreate,
    KnowledgeBaseCreate,
    KnowledgeBaseUpdate,
    KnowledgeNodeCreate,
    LearningRunCreate,
    ModelConfigWrite,
    SourceConfigWrite,
    SourceCreate,
)
from app.secrets import SecretStore


_WHITESPACE_RE = re.compile(r"\s+")
DEFAULT_KNOWLEDGE_BASE_NAME = "默认知识库"
LEGACY_DEFAULT_KNOWLEDGE_BASE_NAME = "Default"


def normalize_name(value: str) -> str:
    normalized = value.strip().lower()
    normalized = _WHITESPACE_RE.sub(" ", normalized)
    return normalized


def merge_unique(existing: Iterable[str], incoming: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for item in [*existing, *incoming]:
        key = normalize_name(item)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item.strip())
    return merged


class KnowledgeRepository:
    def __init__(self, session: Session, secret_store: SecretStore | None = None):
        self.session = session
        self.secret_store = secret_store or SecretStore()

    def ensure_default_knowledge_base(self) -> models.KnowledgeBase:
        statement = select(models.KnowledgeBase).where(models.KnowledgeBase.name == DEFAULT_KNOWLEDGE_BASE_NAME)
        knowledge_base = self.session.scalar(statement)
        if knowledge_base is None:
            legacy_statement = select(models.KnowledgeBase).where(models.KnowledgeBase.name == LEGACY_DEFAULT_KNOWLEDGE_BASE_NAME)
            knowledge_base = self.session.scalar(legacy_statement)
            if knowledge_base is not None:
                knowledge_base.name = DEFAULT_KNOWLEDGE_BASE_NAME
                knowledge_base.description = knowledge_base.description or "用于存放未分类学习任务的默认知识库。"
                self.session.commit()
                self.session.refresh(knowledge_base)
        if knowledge_base is None:
            knowledge_base = models.KnowledgeBase(
                name=DEFAULT_KNOWLEDGE_BASE_NAME,
                description="用于存放未分类学习任务的默认知识库。",
                learning_prompt=None,
            )
            self.session.add(knowledge_base)
            self.session.commit()
            self.session.refresh(knowledge_base)
        return knowledge_base

    def create_knowledge_base(self, payload: KnowledgeBaseCreate) -> models.KnowledgeBase:
        name = payload.name.strip()
        statement = select(models.KnowledgeBase).where(models.KnowledgeBase.name == name)
        existing = self.session.scalar(statement)
        if existing is not None:
            return existing
        knowledge_base = models.KnowledgeBase(
            name=name,
            description=payload.description,
            learning_prompt=_clean_optional_text(payload.learning_prompt),
        )
        self.session.add(knowledge_base)
        self.session.commit()
        self.session.refresh(knowledge_base)
        return knowledge_base

    def update_knowledge_base(
        self,
        knowledge_base: models.KnowledgeBase,
        payload: KnowledgeBaseUpdate,
    ) -> models.KnowledgeBase:
        changed_fields = payload.model_fields_set
        if "name" in changed_fields and payload.name is not None:
            knowledge_base.name = payload.name.strip()
        if "description" in changed_fields:
            knowledge_base.description = payload.description
        if "learning_prompt" in changed_fields:
            knowledge_base.learning_prompt = _clean_optional_text(payload.learning_prompt)
        self.session.commit()
        self.session.refresh(knowledge_base)
        return knowledge_base

    def get_knowledge_base(self, knowledge_base_id: int) -> models.KnowledgeBase | None:
        return self.session.get(models.KnowledgeBase, knowledge_base_id)

    def delete_knowledge_base(self, knowledge_base: models.KnowledgeBase) -> None:
        for run in list(self.list_runs(knowledge_base.id)):
            source_ids = [source.id for source in self.list_sources_for_run(run.id)]
            self._remove_source_references(source_ids)
            self.session.delete(run)
        for edge in list(
            self.session.scalars(
                select(models.KnowledgeEdge).where(models.KnowledgeEdge.knowledge_base_id == knowledge_base.id)
            )
        ):
            self.session.delete(edge)
        for node in list(
            self.session.scalars(
                select(models.KnowledgeNode).where(models.KnowledgeNode.knowledge_base_id == knowledge_base.id)
            )
        ):
            self.session.delete(node)
        self.session.delete(knowledge_base)
        self.session.commit()

    def list_knowledge_bases(self) -> list[models.KnowledgeBase]:
        self.ensure_default_knowledge_base()
        statement = select(models.KnowledgeBase).order_by(models.KnowledgeBase.created_at.asc(), models.KnowledgeBase.id.asc())
        return list(self.session.scalars(statement))

    def resolve_knowledge_base_id(self, knowledge_base_id: int | None = None) -> int:
        if knowledge_base_id is not None:
            return knowledge_base_id
        return self.ensure_default_knowledge_base().id

    def create_run(self, payload: LearningRunCreate) -> models.LearningRun:
        knowledge_base_id = self.resolve_knowledge_base_id(payload.knowledge_base_id)
        run = models.LearningRun(
            keyword=payload.keyword.strip(),
            mode=payload.mode,
            knowledge_base_id=knowledge_base_id,
            learning_prompt=_clean_optional_text(payload.learning_prompt),
        )
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    def get_run(self, run_id: int) -> models.LearningRun | None:
        return self.session.get(models.LearningRun, run_id)

    def list_runs(self, knowledge_base_id: int | None = None) -> list[models.LearningRun]:
        statement = select(models.LearningRun)
        if knowledge_base_id is not None:
            statement = statement.where(models.LearningRun.knowledge_base_id == knowledge_base_id)
        statement = statement.order_by(models.LearningRun.created_at.desc())
        return list(self.session.scalars(statement))

    def update_run_status(
        self,
        run: models.LearningRun,
        status: str,
        completed_at: datetime | None = None,
        error_summary: str | None = None,
    ) -> models.LearningRun:
        run.status = status
        run.completed_at = completed_at
        run.error_summary = error_summary
        self.session.commit()
        self.session.refresh(run)
        return run

    def update_run_retention(self, run: models.LearningRun, is_pinned: bool) -> models.LearningRun:
        run.is_pinned = is_pinned
        self.session.commit()
        self.session.refresh(run)
        return run

    def delete_run(self, run: models.LearningRun) -> None:
        knowledge_base_id = run.knowledge_base_id
        source_ids = [source.id for source in self.list_sources_for_run(run.id)]
        self._remove_source_references(source_ids)
        self.session.delete(run)
        self.session.commit()
        self.prune_orphan_graph(knowledge_base_id, remove_unanchored_edges=True)

    def get_model_config(self) -> models.ModelConfig | None:
        statement = select(models.ModelConfig).order_by(models.ModelConfig.id.asc())
        return self.session.scalar(statement)

    def save_model_config(self, payload: ModelConfigWrite) -> models.ModelConfig:
        config = self.get_model_config()
        api_key_reference = None
        api_key_mask = None
        if payload.api_key:
            api_key_reference = self.secret_store.put(payload.name, payload.api_key)
            api_key_mask = mask_secret(payload.api_key)
        if config is None:
            config = models.ModelConfig(
                name=payload.name,
                base_url=payload.base_url,
                model=payload.model,
                api_key_reference=api_key_reference,
                api_key_mask=api_key_mask,
                default_temperature=payload.default_temperature,
                max_tokens=payload.max_tokens,
            )
            self.session.add(config)
        else:
            config.name = payload.name
            config.base_url = payload.base_url
            config.model = payload.model
            if api_key_reference is not None:
                config.api_key_reference = api_key_reference
                config.api_key_mask = api_key_mask
            config.default_temperature = payload.default_temperature
            config.max_tokens = payload.max_tokens
        self.session.commit()
        self.session.refresh(config)
        return config

    def list_source_configs(self) -> list[models.SourceConfig]:
        statement = select(models.SourceConfig).order_by(models.SourceConfig.id.asc())
        return list(self.session.scalars(statement))

    def ensure_default_source_configs(self) -> list[models.SourceConfig]:
        existing = self.list_source_configs()
        if existing:
            return existing
        return self.replace_source_configs(default_source_configs())

    def replace_source_configs(self, payloads: list[SourceConfigWrite]) -> list[models.SourceConfig]:
        existing = self.list_source_configs()
        for item in existing:
            self.session.delete(item)
        self.session.flush()
        configs = [
            models.SourceConfig(
                name=payload.name,
                type=payload.type,
                enabled=payload.enabled,
                url_or_domain=payload.url_or_domain,
                language_hint=payload.language_hint,
                crawl_depth=payload.crawl_depth,
                rate_limit=payload.rate_limit,
                extractor_rule=payload.extractor_rule,
            )
            for payload in payloads
        ]
        self.session.add_all(configs)
        self.session.commit()
        for config in configs:
            self.session.refresh(config)
        return configs

    def add_source(self, payload: SourceCreate) -> models.Source:
        source = models.Source(
            run_id=payload.run_id,
            url=str(payload.url),
            title=payload.title,
            site=payload.site,
            language=payload.language,
            status=payload.status,
            status_reason=payload.status_reason,
            snippet=payload.snippet,
            extracted_text=payload.extracted_text,
            content_hash=payload.content_hash,
            quality_score=payload.quality_score,
        )
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        self._sync_source_count(source.run_id)
        return source

    def list_sources_for_run(self, run_id: int) -> list[models.Source]:
        statement = select(models.Source).where(models.Source.run_id == run_id).order_by(models.Source.id.asc())
        return list(self.session.scalars(statement))

    def get_source(self, source_id: int) -> models.Source | None:
        return self.session.get(models.Source, source_id)

    def update_source_retention(self, source: models.Source, is_pinned: bool) -> models.Source:
        source.is_pinned = is_pinned
        self.session.commit()
        self.session.refresh(source)
        return source

    def clear_source_text(self, source: models.Source) -> models.Source:
        source.extracted_text = None
        source.content_hash = None
        self.session.commit()
        self.session.refresh(source)
        return source

    def delete_source(self, source: models.Source) -> int:
        run_id = source.run_id
        source_id = source.id
        run = source.run
        knowledge_base_id = run.knowledge_base_id if run else None
        self._remove_source_references([source_id])
        self.session.delete(source)
        self.session.commit()
        self._sync_source_count(run_id)
        if knowledge_base_id is not None:
            self.prune_orphan_graph(knowledge_base_id)
        return run_id

    def add_card(self, payload: CardCreate) -> models.Card:
        card = models.Card(**payload.model_dump())
        self.session.add(card)
        self.session.commit()
        self.session.refresh(card)
        return card

    def list_cards_for_run(self, run_id: int) -> list[models.Card]:
        statement = select(models.Card).where(models.Card.run_id == run_id).order_by(models.Card.sort_order.asc())
        return list(self.session.scalars(statement))

    def delete_cards_for_run_by_types(
        self,
        run_id: int,
        card_types: Iterable[str],
        approval_status: str | None = None,
    ) -> None:
        deleted_types = set(card_types)
        if not deleted_types:
            return
        statement = select(models.Card).where(
            models.Card.run_id == run_id,
            models.Card.type.in_(deleted_types),
        )
        if approval_status is not None:
            statement = statement.where(models.Card.approval_status == approval_status)
        for card in list(
            self.session.scalars(statement)
        ):
            self.session.delete(card)
        self.session.commit()

    def update_card_approval(self, card: models.Card, node_ids: list[int]) -> models.Card:
        card.approval_status = "approved"
        card.node_ids = node_ids
        self.session.commit()
        self.session.refresh(card)
        return card

    def upsert_node(self, payload: KnowledgeNodeCreate) -> models.KnowledgeNode:
        normalized_name = normalize_name(payload.name)
        statement = select(models.KnowledgeNode).where(
            models.KnowledgeNode.knowledge_base_id == payload.knowledge_base_id,
            models.KnowledgeNode.type == payload.type,
            models.KnowledgeNode.normalized_name == normalized_name,
        )
        node = self.session.scalar(statement)
        if node is None:
            node = models.KnowledgeNode(
                knowledge_base_id=payload.knowledge_base_id,
                type=payload.type,
                name=payload.name.strip(),
                normalized_name=normalized_name,
                summary=payload.summary,
                aliases=payload.aliases,
                tags=payload.tags,
            )
            self.session.add(node)
        else:
            if payload.summary and not node.summary:
                node.summary = payload.summary
            node.aliases = merge_unique(node.aliases or [], payload.aliases)
            node.tags = merge_unique(node.tags or [], payload.tags)
        self.session.commit()
        self.session.refresh(node)
        return node

    def add_edge(self, payload: KnowledgeEdgeCreate) -> models.KnowledgeEdge:
        statement = select(models.KnowledgeEdge).where(
            models.KnowledgeEdge.knowledge_base_id == payload.knowledge_base_id,
            models.KnowledgeEdge.source_node_id == payload.source_node_id,
            models.KnowledgeEdge.target_node_id == payload.target_node_id,
            models.KnowledgeEdge.type == payload.type,
        )
        edge = self.session.scalar(statement)
        if edge is None:
            edge = models.KnowledgeEdge(**payload.model_dump())
            self.session.add(edge)
        else:
            edge.confidence = max(edge.confidence, payload.confidence)
            edge.evidence_source_ids = merge_int_unique(edge.evidence_source_ids or [], payload.evidence_source_ids)
        self.session.commit()
        self.session.refresh(edge)
        return edge

    def get_node(self, node_id: int) -> models.KnowledgeNode | None:
        return self.session.get(models.KnowledgeNode, node_id)

    def search_nodes(
        self,
        query: str | None = None,
        knowledge_base_id: int | None = None,
        node_type: str | None = None,
        limit: int = 50,
    ) -> list[models.KnowledgeNode]:
        statement = select(models.KnowledgeNode)
        if knowledge_base_id is not None:
            statement = statement.where(models.KnowledgeNode.knowledge_base_id == knowledge_base_id)
        if node_type:
            statement = statement.where(models.KnowledgeNode.type == node_type)
        if query:
            normalized_query = f"%{normalize_name(query)}%"
            statement = statement.where(models.KnowledgeNode.normalized_name.like(normalized_query))
        statement = statement.order_by(models.KnowledgeNode.updated_at.desc(), models.KnowledgeNode.id.asc()).limit(limit)
        return list(self.session.scalars(statement))

    def list_graph(self, knowledge_base_id: int | None = None) -> tuple[list[models.KnowledgeNode], list[models.KnowledgeEdge]]:
        node_statement = select(models.KnowledgeNode)
        edge_statement = select(models.KnowledgeEdge)
        if knowledge_base_id is not None:
            node_statement = node_statement.where(models.KnowledgeNode.knowledge_base_id == knowledge_base_id)
            edge_statement = edge_statement.where(models.KnowledgeEdge.knowledge_base_id == knowledge_base_id)
        nodes = list(self.session.scalars(node_statement.order_by(models.KnowledgeNode.id.asc())))
        edges = list(self.session.scalars(edge_statement.order_by(models.KnowledgeEdge.id.asc())))
        return nodes, edges

    def prune_orphan_graph(self, knowledge_base_id: int, remove_unanchored_edges: bool = False) -> None:
        source_ids = {
            source_id
            for (source_id,) in self.session.execute(
                select(models.Source.id).join(models.LearningRun).where(models.LearningRun.knowledge_base_id == knowledge_base_id)
            )
        }
        card_node_ids = self._card_node_ids(knowledge_base_id)

        for edge in list(
            self.session.scalars(
                select(models.KnowledgeEdge).where(models.KnowledgeEdge.knowledge_base_id == knowledge_base_id)
            )
        ):
            evidence_ids = [source_id for source_id in edge.evidence_source_ids or [] if source_id in source_ids]
            edge.evidence_source_ids = evidence_ids
            if edge.type == "supported_by_source" and not evidence_ids:
                self.session.delete(edge)
            elif (
                remove_unanchored_edges
                and not evidence_ids
                and edge.source_node_id not in card_node_ids
                and edge.target_node_id not in card_node_ids
            ):
                self.session.delete(edge)

        self.session.flush()
        referenced_node_ids = self._card_node_ids(knowledge_base_id)
        for edge in self.session.scalars(
            select(models.KnowledgeEdge).where(models.KnowledgeEdge.knowledge_base_id == knowledge_base_id)
        ):
            referenced_node_ids.add(edge.source_node_id)
            referenced_node_ids.add(edge.target_node_id)

        for node in list(
            self.session.scalars(
                select(models.KnowledgeNode).where(models.KnowledgeNode.knowledge_base_id == knowledge_base_id)
            )
        ):
            if node.id in referenced_node_ids:
                continue
            self.session.delete(node)
        self.session.commit()

    def list_all_sources(self, knowledge_base_id: int | None = None) -> list[models.Source]:
        statement = select(models.Source).join(models.LearningRun)
        if knowledge_base_id is not None:
            statement = statement.where(models.LearningRun.knowledge_base_id == knowledge_base_id)
        return list(self.session.scalars(statement.order_by(models.Source.id.asc())))

    def list_all_cards(self, knowledge_base_id: int | None = None) -> list[models.Card]:
        statement = select(models.Card).join(models.LearningRun)
        if knowledge_base_id is not None:
            statement = statement.where(models.LearningRun.knowledge_base_id == knowledge_base_id)
        return list(self.session.scalars(statement.order_by(models.Card.id.asc())))

    def _sync_source_count(self, run_id: int) -> None:
        run = self.session.get(models.LearningRun, run_id)
        if run is None:
            return
        run.source_count = len(run.sources)
        self.session.commit()

    def _card_node_ids(self, knowledge_base_id: int) -> set[int]:
        node_ids: set[int] = set()
        statement = select(models.Card.node_ids).join(models.LearningRun).where(
            models.LearningRun.knowledge_base_id == knowledge_base_id
        )
        for (card_node_ids,) in self.session.execute(statement):
            node_ids.update(card_node_ids or [])
        return node_ids

    def _remove_source_references(self, source_ids: Iterable[int]) -> None:
        deleted_ids = set(source_ids)
        if not deleted_ids:
            return
        for card in self.session.scalars(select(models.Card)):
            card.source_ids = [existing_id for existing_id in card.source_ids or [] if existing_id not in deleted_ids]
        for edge in self.session.scalars(select(models.KnowledgeEdge)):
            edge.evidence_source_ids = [
                existing_id for existing_id in edge.evidence_source_ids or [] if existing_id not in deleted_ids
            ]
        self.session.flush()


def mask_secret(value: str) -> str:
    stripped = value.strip()
    if len(stripped) <= 8:
        return "********"
    return f"{stripped[:4]}...{stripped[-4:]}"


def merge_int_unique(existing: Iterable[int], incoming: Iterable[int]) -> list[int]:
    merged: list[int] = []
    seen: set[int] = set()
    for item in [*existing, *incoming]:
        if item in seen:
            continue
        seen.add(item)
        merged.append(item)
    return merged


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None
