from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session, init_db
from app.portable import export_knowledge, import_knowledge
from app.repositories import KnowledgeRepository
from app.schemas import (
    CardRead,
    GraphRead,
    HealthResponse,
    KnowledgeBaseCreate,
    KnowledgeBaseRead,
    KnowledgeExport,
    LearningRunCreate,
    LearningRunRead,
    ModelConfigRead,
    ModelConfigWrite,
    SourceConfigRead,
    SourceConfigWrite,
    SourceRead,
)
from app.services import LearningRunService


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

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


@app.get("/settings/sources", response_model=list[SourceConfigRead])
def get_source_settings(session: Session = Depends(get_session)):
    return KnowledgeRepository(session).list_source_configs()


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


@app.post("/runs", response_model=LearningRunRead, status_code=201)
def create_run(
    payload: LearningRunCreate,
    session: Session = Depends(get_session),
):
    repository = KnowledgeRepository(session)
    knowledge_base_id = repository.resolve_knowledge_base_id(payload.knowledge_base_id)
    if repository.get_knowledge_base(knowledge_base_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return repository.create_run(payload)


@app.get("/runs", response_model=list[LearningRunRead])
def list_runs(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    resolved_id = repository.resolve_knowledge_base_id(knowledge_base_id)
    if repository.get_knowledge_base(resolved_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return repository.list_runs(resolved_id)


@app.post("/runs/{run_id}/collect", response_model=LearningRunRead)
def collect_run_sources(run_id: int, session: Session = Depends(get_session)):
    run = LearningRunService(session).collect_sources(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@app.get("/runs/{run_id}/sources", response_model=list[SourceRead])
def list_run_sources(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if repository.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return repository.list_sources_for_run(run_id)


@app.post("/runs/{run_id}/generate", response_model=LearningRunRead)
def generate_run_output(run_id: int, session: Session = Depends(get_session)):
    run = LearningRunService(session).generate_learning_output(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@app.get("/runs/{run_id}/cards", response_model=list[CardRead])
def list_run_cards(run_id: int, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if repository.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return repository.list_cards_for_run(run_id)


@app.get("/knowledge/graph", response_model=GraphRead)
def get_knowledge_graph(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    resolved_id = repository.resolve_knowledge_base_id(knowledge_base_id)
    if repository.get_knowledge_base(resolved_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    nodes, edges = repository.list_graph(resolved_id)
    return GraphRead(nodes=nodes, edges=edges)


@app.get("/export", response_model=KnowledgeExport)
def export_data(knowledge_base_id: int | None = None, session: Session = Depends(get_session)):
    repository = KnowledgeRepository(session)
    if knowledge_base_id is not None and repository.get_knowledge_base(knowledge_base_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return export_knowledge(repository, knowledge_base_id=knowledge_base_id)


@app.post("/import", response_model=KnowledgeExport)
def import_data(payload: KnowledgeExport, session: Session = Depends(get_session)):
    return import_knowledge(KnowledgeRepository(session), payload)
