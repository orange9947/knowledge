import re
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import (
    CardCreate,
    KnowledgeEdgeCreate,
    KnowledgeNodeCreate,
    LearningRunCreate,
    ModelConfigWrite,
    SourceConfigWrite,
    SourceCreate,
)


_WHITESPACE_RE = re.compile(r"\s+")


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
    def __init__(self, session: Session):
        self.session = session

    def create_run(self, payload: LearningRunCreate) -> models.LearningRun:
        run = models.LearningRun(keyword=payload.keyword.strip(), mode=payload.mode)
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    def get_run(self, run_id: int) -> models.LearningRun | None:
        return self.session.get(models.LearningRun, run_id)

    def list_runs(self) -> list[models.LearningRun]:
        statement = select(models.LearningRun).order_by(models.LearningRun.created_at.desc())
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

    def get_model_config(self) -> models.ModelConfig | None:
        statement = select(models.ModelConfig).order_by(models.ModelConfig.id.asc())
        return self.session.scalar(statement)

    def save_model_config(self, payload: ModelConfigWrite) -> models.ModelConfig:
        config = self.get_model_config()
        api_key_reference = None
        if payload.api_key:
            api_key_reference = mask_secret(payload.api_key)
        if config is None:
            config = models.ModelConfig(
                name=payload.name,
                base_url=payload.base_url,
                model=payload.model,
                api_key_reference=api_key_reference,
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
            config.default_temperature = payload.default_temperature
            config.max_tokens = payload.max_tokens
        self.session.commit()
        self.session.refresh(config)
        return config

    def list_source_configs(self) -> list[models.SourceConfig]:
        statement = select(models.SourceConfig).order_by(models.SourceConfig.id.asc())
        return list(self.session.scalars(statement))

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

    def add_card(self, payload: CardCreate) -> models.Card:
        card = models.Card(**payload.model_dump())
        self.session.add(card)
        self.session.commit()
        self.session.refresh(card)
        return card

    def upsert_node(self, payload: KnowledgeNodeCreate) -> models.KnowledgeNode:
        normalized_name = normalize_name(payload.name)
        statement = select(models.KnowledgeNode).where(
            models.KnowledgeNode.type == payload.type,
            models.KnowledgeNode.normalized_name == normalized_name,
        )
        node = self.session.scalar(statement)
        if node is None:
            node = models.KnowledgeNode(
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
        edge = models.KnowledgeEdge(**payload.model_dump())
        self.session.add(edge)
        self.session.commit()
        self.session.refresh(edge)
        return edge

    def _sync_source_count(self, run_id: int) -> None:
        run = self.session.get(models.LearningRun, run_id)
        if run is None:
            return
        run.source_count = len(run.sources)
        self.session.commit()


def mask_secret(value: str) -> str:
    stripped = value.strip()
    if len(stripped) <= 8:
        return "********"
    return f"{stripped[:4]}...{stripped[-4:]}"
