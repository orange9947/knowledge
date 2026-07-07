from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session, init_db
from app.portable import export_knowledge, import_knowledge
from app.pydantic_compat import model_dump, model_validate
from app.repositories import KnowledgeRepository
from app.schemas import (
    AssistantQueryRequest,
    AssistantQueryResponse,
    CardRead,
    CardApprovalRequest,
    CardApprovalResult,
    GraphRead,
    HealthResponse,
    KnowledgeBaseCreate,
    KnowledgeBaseRead,
    KnowledgeBaseUpdate,
    KnowledgeExport,
    KnowledgeNodeCreate,
    KnowledgeNodeDetailRead,
    KnowledgeNodeRead,
    KnowledgeNodeUpdate,
    LearningRunCreate,
    LearningRunRead,
    ModelConfigRead,
    ModelConnectionTest,
    ModelConnectionTestRead,
    ModelConfigWrite,
    RetentionUpdate,
    RunDetailRead,
    SourceConfigRead,
    SourceConfigWrite,
    SourceRead,
)
from app.assistant import GraphAssistantService
from app.services import LearningRunService
from app.ai import AIOrchestrator, AIProviderError
from app import models


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

KNOWLEDGE_BASE_NOT_FOUND = "知识库不存在"
NODE_NOT_FOUND = "节点不存在"
RUN_NOT_FOUND = "任务不存在"
SOURCE_NOT_FOUND = "来源不存在"
LAST_KNOWLEDGE_BASE_DELETE_FORBIDDEN = "至少需要保留一个知识库"
MODEL_API_KEY_REQUIRED = "请先填写或保存 API 密钥"


def _source_read(source: models.Source, include_text: bool = True) -> SourceRead:
    payload = model_dump(model_validate(SourceRead, source))
    if not include_text:
        payload["extracted_text"] = None
    return SourceRead(**payload)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health(session: Session = Depends(get_session)) -> HealthResponse:
    session.execute(text("select 1"))
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        version=settings.app_version,
        database="ready",
    )


@app.get("/settings/model", response_model=ModelConfigRead | None)
def get_model_settings(session: Session = Depends(get_session)):
    return KnowledgeRepository(session).get_model_config()


@app.put("/settings/model", response_model=ModelConfigRead)
def put_model_settings(
    payload: ModelConfigWrite,
    session: Session = Depends(get_session),
):
    return KnowledgeRepository(session).save_model_config(payload)


@app.post("/settings/model/test", response_model=ModelConnectionTestRead)
def test_model_connection(
    payload: ModelConnectionTest,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    saved_config = repository.get_model_config()
    api_key = payload.api_key
    if not api_key and saved_config is not None:
        api_key = repository.secret_store.get(saved_config.api_key_reference)
    if not api_key:
        return ModelConnectionTestRead(ok=False, message=MODEL_API_KEY_REQUIRED, model=payload.model)

    transient_config = models.ModelConfig(
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key_reference=None,
        default_temperature=payload.default_temperature,
        max_tokens=payload.max_tokens,
    )
    ok, message, latency_ms = AIOrchestrator(secret_store=repository.secret_store).test_connection(
        transient_config,
        api_key,
    )
    return ModelConnectionTestRead(ok=ok, message=message, model=payload.model, latency_ms=latency_ms)


@app.get("/settings/sources", response_model=list[SourceConfigRead])
def get_source_settings(session: Session = Depends(get_session)):
    return KnowledgeRepository(session).ensure_default_source_configs()


@app.put("/settings/sources", response_model=list[SourceConfigRead])
def put_source_settings(
    payload: list[SourceConfigWrite],
    session: Session = Depends(get_session),
):
    return KnowledgeRepository(session).replace_source_configs(payload)


@app.get("/knowledge-bases", response_model=list[KnowledgeBaseRead])
def list_knowledge_bases(session: Session = Depends(get_session)):
    return KnowledgeRepository(session).list_knowledge_bases()


@app.post("/knowledge-bases", response_model=KnowledgeBaseRead, status_code=201)
def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    session: Session = Depends(get_session),
):
    return KnowledgeRepository(session).create_knowledge_base(payload)


@app.patch("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseRead)
def update_knowledge_base(
    knowledge_base_id: int,
    payload: KnowledgeBaseUpdate,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    knowledge_base = repository.get_knowledge_base(knowledge_base_id)
    if knowledge_base is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return repository.update_knowledge_base(knowledge_base, payload)


@app.delete("/knowledge-bases/{knowledge_base_id}", status_code=204)
def delete_knowledge_base(knowledge_base_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    knowledge_base = repository.get_knowledge_base(knowledge_base_id)
    if knowledge_base is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    if len(repository.list_knowledge_bases()) <= 1:
        raise HTTPException(status_code=409, detail=LAST_KNOWLEDGE_BASE_DELETE_FORBIDDEN)
    repository.delete_knowledge_base(knowledge_base)
    return None


@app.post("/runs", response_model=LearningRunRead, status_code=201)
def create_run(
    payload: LearningRunCreate,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    knowledge_base_id = repository.resolve_knowledge_base_id(payload.knowledge_base_id)
    if repository.get_knowledge_base(knowledge_base_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return repository.create_run(payload)


@app.get("/runs", response_model=list[LearningRunRead])
def list_runs(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    resolved_id = repository.resolve_knowledge_base_id(knowledge_base_id)
    if repository.get_knowledge_base(resolved_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return repository.list_runs(resolved_id)


@app.get("/runs/{run_id}", response_model=RunDetailRead)
def get_run_detail(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    run = repository.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return RunDetailRead(
        run=model_validate(LearningRunRead, run),
        sources=[_source_read(source, include_text=False) for source in repository.list_sources_for_run(run_id)],
        cards=[model_validate(CardRead, card) for card in repository.list_cards_for_run(run_id)],
    )


@app.get("/runs/{run_id}/status", response_model=LearningRunRead)
def get_run_status(run_id: int, session: Session = Depends(get_session)):
    run = KnowledgeRepository(session).get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.patch("/runs/{run_id}/retention", response_model=LearningRunRead)
def update_run_retention(
    run_id: int,
    payload: RetentionUpdate,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    run = repository.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return repository.update_run_retention(run, payload.is_pinned)


@app.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    run = repository.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    repository.delete_run(run)
    return None


@app.post("/runs/{run_id}/collect", response_model=LearningRunRead)
def collect_run_sources(run_id: int, session: Session = Depends(get_session)):
    run = LearningRunService(session).collect_sources(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.post("/runs/{run_id}/pause", response_model=LearningRunRead)
def pause_run_collection(run_id: int, session: Session = Depends(get_session)):
    run = LearningRunService(session).pause_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.post("/runs/{run_id}/ai-collect", response_model=LearningRunRead)
def ai_collect_run_sources(run_id: int, session: Session = Depends(get_session)):
    try:
        run = LearningRunService(session).ai_collect_sources(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AIProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.get("/runs/{run_id}/sources", response_model=list[SourceRead])
def list_run_sources(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if repository.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return repository.list_sources_for_run(run_id)


@app.get("/sources/{source_id}", response_model=SourceRead)
def get_source(source_id: int, session: Session = Depends(get_session)):
    source = KnowledgeRepository(session).get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=SOURCE_NOT_FOUND)
    return source


@app.patch("/sources/{source_id}/retention", response_model=SourceRead)
def update_source_retention(
    source_id: int,
    payload: RetentionUpdate,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    source = repository.get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=SOURCE_NOT_FOUND)
    return repository.update_source_retention(source, payload.is_pinned)


@app.post("/sources/{source_id}/clear-text", response_model=SourceRead)
def clear_source_text(source_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    source = repository.get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=SOURCE_NOT_FOUND)
    return repository.clear_source_text(source)


@app.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    source = repository.get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=SOURCE_NOT_FOUND)
    repository.delete_source(source)
    return None


@app.post("/runs/{run_id}/generate", response_model=LearningRunRead)
def generate_run_output(run_id: int, session: Session = Depends(get_session)):
    try:
        run = LearningRunService(session).generate_learning_output(run_id)
    except AIProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.post("/runs/{run_id}/summarize", response_model=LearningRunRead)
def summarize_run_output(run_id: int, session: Session = Depends(get_session)):
    try:
        run = LearningRunService(session).summarize_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AIProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if run is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return run


@app.get("/runs/{run_id}/cards", response_model=list[CardRead])
def list_run_cards(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if repository.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return repository.list_cards_for_run(run_id)


@app.post("/runs/{run_id}/cards/approve", response_model=CardApprovalResult)
def approve_run_cards(
    run_id: int,
    payload: CardApprovalRequest,
    session: Session = Depends(get_session),
):
    if not payload.card_ids:
        raise HTTPException(status_code=422, detail="请选择要加入图谱的知识卡片")
    try:
        result = LearningRunService(session).approve_cards(run_id, payload.card_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    return result


@app.get("/knowledge/graph", response_model=GraphRead)
def get_knowledge_graph(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    resolved_id = repository.resolve_knowledge_base_id(knowledge_base_id)
    if repository.get_knowledge_base(resolved_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    nodes, edges = repository.list_graph(resolved_id)
    return GraphRead(nodes=nodes, edges=edges)


@app.post("/knowledge/assistant/query", response_model=AssistantQueryResponse)
def query_knowledge_assistant(payload: AssistantQueryRequest, session: Session = Depends(get_session)):
    try:
        return GraphAssistantService(session).answer(payload)
    except ValueError as exc:
        message = str(exc)
        status = 404 if message in {KNOWLEDGE_BASE_NOT_FOUND, NODE_NOT_FOUND} else 400
        raise HTTPException(status_code=status, detail=message) from exc
    except AIProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.post("/knowledge/nodes", response_model=KnowledgeNodeRead, status_code=201)
def create_knowledge_node(payload: KnowledgeNodeCreate, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if repository.get_knowledge_base(payload.knowledge_base_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return repository.create_node(payload)


@app.get("/knowledge/nodes/{node_id}", response_model=KnowledgeNodeDetailRead)
def get_knowledge_node(
    node_id: int,
    knowledge_base_id: int | None = None,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    node = repository.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    if knowledge_base_id is not None and node.knowledge_base_id != knowledge_base_id:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    cards = repository.list_cards_for_node(node.id, node.knowledge_base_id)
    source_ids = {source_id for card in cards for source_id in (card.source_ids or [])}
    sources = repository.list_sources_by_ids(source_ids)
    node_payload = model_dump(model_validate(KnowledgeNodeRead, node))
    return KnowledgeNodeDetailRead(**node_payload, cards=cards, sources=sources)


@app.patch("/knowledge/nodes/{node_id}", response_model=KnowledgeNodeRead)
def update_knowledge_node(
    node_id: int,
    payload: KnowledgeNodeUpdate,
    knowledge_base_id: int | None = None,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    node = repository.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    if knowledge_base_id is not None and node.knowledge_base_id != knowledge_base_id:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    try:
        return repository.update_node(node, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/knowledge/nodes/{node_id}", status_code=204)
def delete_knowledge_node(
    node_id: int,
    knowledge_base_id: int | None = None,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    node = repository.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    if knowledge_base_id is not None and node.knowledge_base_id != knowledge_base_id:
        raise HTTPException(status_code=404, detail=NODE_NOT_FOUND)
    repository.delete_node(node)
    return None


@app.get("/knowledge/search", response_model=list[KnowledgeNodeRead])
def search_knowledge(
    q: str | None = None,
    type: str | None = None,
    knowledge_base_id: int | None = None,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    resolved_id = repository.resolve_knowledge_base_id(knowledge_base_id)
    if repository.get_knowledge_base(resolved_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return repository.search_nodes(q, knowledge_base_id=resolved_id, node_type=type)


@app.get("/export", response_model=KnowledgeExport)
def export_data(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if knowledge_base_id is not None and repository.get_knowledge_base(knowledge_base_id) is None:
        raise HTTPException(status_code=404, detail=KNOWLEDGE_BASE_NOT_FOUND)
    return export_knowledge(repository, knowledge_base_id=knowledge_base_id)


@app.post("/import", response_model=KnowledgeExport)
def import_data(payload: KnowledgeExport, session: Session = Depends(get_session)):
    return import_knowledge(KnowledgeRepository(session), payload)
