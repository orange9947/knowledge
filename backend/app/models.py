from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    __table_args__ = (
        UniqueConstraint("name", name="uq_knowledge_base_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    runs: Mapped[list["LearningRun"]] = relationship(back_populates="knowledge_base")
    nodes: Mapped[list["KnowledgeNode"]] = relationship(back_populates="knowledge_base")
    edges: Mapped[list["KnowledgeEdge"]] = relationship(back_populates="knowledge_base")


class LearningRun(Base):
    __tablename__ = "learning_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    knowledge_base_id: Mapped[int] = mapped_column(ForeignKey("knowledge_bases.id"), index=True, default=1)
    keyword: Mapped[str] = mapped_column(String(240), index=True)
    mode: Mapped[str] = mapped_column(String(32), default="light", index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    language_policy: Mapped[str] = mapped_column(String(64), default="zh-en-to-zh")
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    model_provider_config_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_pinned: Mapped[bool] = mapped_column(default=False)

    knowledge_base: Mapped[KnowledgeBase] = relationship(back_populates="runs")
    sources: Mapped[list["Source"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    cards: Mapped[list["Card"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("learning_runs.id"), index=True)
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    site: Mapped[str | None] = mapped_column(String(240), nullable=True)
    language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_pinned: Mapped[bool] = mapped_column(default=False)

    run: Mapped[LearningRun] = relationship(back_populates="sources")


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("learning_runs.id"), index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    node_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    run: Mapped[LearningRun] = relationship(back_populates="cards")


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"
    __table_args__ = (
        UniqueConstraint(
            "knowledge_base_id",
            "type",
            "normalized_name",
            name="uq_knowledge_node_base_type_name",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    knowledge_base_id: Mapped[int] = mapped_column(ForeignKey("knowledge_bases.id"), index=True, default=1)
    type: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(300))
    normalized_name: Mapped[str] = mapped_column(String(300), index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    knowledge_base: Mapped[KnowledgeBase] = relationship(back_populates="nodes")
    outgoing_edges: Mapped[list["KnowledgeEdge"]] = relationship(
        foreign_keys="KnowledgeEdge.source_node_id",
        back_populates="source_node",
        cascade="all, delete-orphan",
    )
    incoming_edges: Mapped[list["KnowledgeEdge"]] = relationship(
        foreign_keys="KnowledgeEdge.target_node_id",
        back_populates="target_node",
        cascade="all, delete-orphan",
    )


class KnowledgeEdge(Base):
    __tablename__ = "knowledge_edges"

    id: Mapped[int] = mapped_column(primary_key=True)
    knowledge_base_id: Mapped[int] = mapped_column(ForeignKey("knowledge_bases.id"), index=True, default=1)
    source_node_id: Mapped[int] = mapped_column(ForeignKey("knowledge_nodes.id"), index=True)
    target_node_id: Mapped[int] = mapped_column(ForeignKey("knowledge_nodes.id"), index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    evidence_source_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    knowledge_base: Mapped[KnowledgeBase] = relationship(back_populates="edges")
    source_node: Mapped[KnowledgeNode] = relationship(
        foreign_keys=[source_node_id],
        back_populates="outgoing_edges",
    )
    target_node: Mapped[KnowledgeNode] = relationship(
        foreign_keys=[target_node_id],
        back_populates="incoming_edges",
    )


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="默认配置")
    base_url: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(160))
    api_key_reference: Mapped[str | None] = mapped_column(String(240), nullable=True)
    api_key_mask: Mapped[str | None] = mapped_column(String(80), nullable=True)
    default_temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)


class SourceConfig(Base):
    __tablename__ = "source_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(64), index=True)
    enabled: Mapped[bool] = mapped_column(default=True)
    url_or_domain: Mapped[str | None] = mapped_column(Text, nullable=True)
    language_hint: Mapped[str | None] = mapped_column(String(32), nullable=True)
    crawl_depth: Mapped[int] = mapped_column(Integer, default=1)
    rate_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    extractor_rule: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
