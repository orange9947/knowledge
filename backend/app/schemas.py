from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl

from app.pydantic_compat import OrmBaseModel


RunMode = Literal["light", "standard", "deep"]
RunStatus = Literal["pending", "running", "completed", "partial", "failed"]
SourceStatus = Literal["pending", "success", "partial", "failed", "skipped"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    app_name: str
    version: str
    database: Literal["ready"]


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    learning_prompt: str | None = None


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    learning_prompt: str | None = None


class KnowledgeBaseRead(OrmBaseModel):
    id: int
    name: str
    description: str | None
    learning_prompt: str | None = None
    created_at: datetime
    updated_at: datetime


class LearningRunCreate(BaseModel):
    keyword: str = Field(min_length=1, max_length=240)
    mode: RunMode = "light"
    knowledge_base_id: int | None = None
    learning_prompt: str | None = None


class LearningRunRead(OrmBaseModel):
    id: int
    knowledge_base_id: int = 1
    keyword: str
    mode: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    language_policy: str
    source_count: int
    token_usage_estimate: int | None
    error_summary: str | None
    is_pinned: bool = False
    learning_prompt: str | None = None


class RunDetailRead(BaseModel):
    run: LearningRunRead
    sources: list["SourceRead"]
    cards: list["CardRead"]


class ModelConfigWrite(BaseModel):
    name: str = Field(default="默认配置", min_length=1, max_length=120)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=160)
    api_key: str | None = Field(default=None, min_length=1)
    default_temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=4096, ge=256, le=200000)


class ModelConfigRead(OrmBaseModel):
    id: int
    name: str
    base_url: str
    model: str
    api_key_reference: str | None
    api_key_mask: str | None = None
    default_temperature: float
    max_tokens: int


class ModelConnectionTest(BaseModel):
    name: str = Field(default="默认配置", min_length=1, max_length=120)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=160)
    api_key: str | None = Field(default=None, min_length=1)
    default_temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=16, le=200000)


class ModelConnectionTestRead(BaseModel):
    ok: bool
    message: str
    model: str
    latency_ms: int | None = None


class SourceConfigWrite(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    type: Literal["builtin", "rss", "domain", "entry_url", "search_page"]
    enabled: bool = True
    url_or_domain: str | None = None
    language_hint: str | None = None
    crawl_depth: int = Field(default=1, ge=0, le=5)
    rate_limit: float | None = Field(default=None, ge=0)
    extractor_rule: dict[str, object] | None = None


class SourceConfigRead(OrmBaseModel):
    id: int
    name: str
    type: str
    enabled: bool
    url_or_domain: str | None
    language_hint: str | None
    crawl_depth: int
    rate_limit: float | None
    extractor_rule: dict[str, object] | None


class SourceCreate(BaseModel):
    run_id: int
    url: HttpUrl | str
    title: str | None = None
    site: str | None = None
    language: str | None = None
    status: SourceStatus = "pending"
    status_reason: str | None = None
    snippet: str | None = None
    extracted_text: str | None = None
    content_hash: str | None = None
    quality_score: float | None = None


class SourceRead(OrmBaseModel):
    id: int
    run_id: int
    url: str
    title: str | None
    site: str | None
    language: str | None
    published_at: datetime | None
    status: str
    status_reason: str | None
    snippet: str | None
    extracted_text: str | None
    content_hash: str | None
    quality_score: float | None
    is_pinned: bool = False


class RetentionUpdate(BaseModel):
    is_pinned: bool


class CardCreate(BaseModel):
    run_id: int
    type: str
    title: str
    summary: str
    details: str | None = None
    source_ids: list[int] = Field(default_factory=list)
    node_ids: list[int] = Field(default_factory=list)
    sort_order: int = 0
    approval_status: Literal["candidate", "approved"] = "approved"
    candidate_payload: dict[str, Any] | None = None


class CardRead(OrmBaseModel):
    id: int
    run_id: int
    type: str
    title: str
    summary: str
    details: str | None
    source_ids: list[int]
    node_ids: list[int]
    sort_order: int
    approval_status: str = "approved"
    candidate_payload: dict[str, Any] | None = None


class CardApprovalRequest(BaseModel):
    card_ids: list[int]


class AssistantQueryRequest(BaseModel):
    knowledge_base_id: int
    question: str = Field(min_length=1, max_length=2000)
    selected_node_id: int | None = None
    allow_web: bool = True
    create_candidates: bool = True


class AssistantReference(BaseModel):
    kind: Literal["graph", "web", "model"]
    title: str
    summary: str | None = None
    node_id: int | None = None
    source_id: int | None = None
    url: str | None = None


class AssistantCandidateCard(BaseModel):
    id: int | None = None
    run_id: int | None = None
    type: str
    title: str
    summary: str
    details: str | None = None
    source_ids: list[int] = Field(default_factory=list)
    approval_status: str = "candidate"


class AssistantQueryResponse(BaseModel):
    answer: str
    used_web: bool = False
    run_id: int | None = None
    graph_references: list[AssistantReference] = Field(default_factory=list)
    web_references: list[AssistantReference] = Field(default_factory=list)
    candidate_cards: list[AssistantCandidateCard] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class KnowledgeNodeCreate(BaseModel):
    knowledge_base_id: int
    type: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    summary: str | None = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class KnowledgeNodeUpdate(BaseModel):
    type: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    summary: str | None = None
    aliases: list[str] | None = None
    tags: list[str] | None = None


class KnowledgeEdgeCreate(BaseModel):
    knowledge_base_id: int
    source_node_id: int
    target_node_id: int
    type: str
    confidence: float = Field(default=0.5, ge=0, le=1)
    evidence_source_ids: list[int] = Field(default_factory=list)


class KnowledgeNodeRead(OrmBaseModel):
    id: int
    knowledge_base_id: int = 1
    type: str
    name: str
    normalized_name: str
    summary: str | None
    aliases: list[str]
    tags: list[str]


class KnowledgeEdgeRead(OrmBaseModel):
    id: int
    knowledge_base_id: int = 1
    source_node_id: int
    target_node_id: int
    type: str
    confidence: float
    evidence_source_ids: list[int]


class GraphRead(BaseModel):
    nodes: list[KnowledgeNodeRead]
    edges: list[KnowledgeEdgeRead]


class KnowledgeExport(BaseModel):
    version: int = 1
    knowledge_bases: list[KnowledgeBaseRead] = Field(default_factory=list)
    runs: list[LearningRunRead]
    sources: list[SourceRead]
    cards: list[CardRead]
    nodes: list[KnowledgeNodeRead]
    edges: list[KnowledgeEdgeRead]
