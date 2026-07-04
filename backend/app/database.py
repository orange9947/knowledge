from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import ensure_sqlite_parent, get_settings


class Base(DeclarativeBase):
    pass


def _connect_args(database_url: str) -> dict[str, object]:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or get_settings().database_url
    ensure_sqlite_parent(url)
    return create_engine(url, connect_args=_connect_args(url))


engine = build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db(target_engine: Engine | None = None) -> None:
    from app import models  # noqa: F401

    active_engine = target_engine or engine
    Base.metadata.create_all(bind=active_engine)
    _migrate_schema_columns(active_engine)
    with Session(active_engine) as session:
        from app.repositories import KnowledgeRepository

        repository = KnowledgeRepository(session)
        default_base = repository.ensure_default_knowledge_base()
        repository.ensure_default_source_configs()
        session.execute(
            text("update learning_runs set knowledge_base_id = :base_id where knowledge_base_id is null"),
            {"base_id": default_base.id},
        )
        session.execute(
            text("update knowledge_nodes set knowledge_base_id = :base_id where knowledge_base_id is null"),
            {"base_id": default_base.id},
        )
        session.execute(
            text("update knowledge_edges set knowledge_base_id = :base_id where knowledge_base_id is null"),
            {"base_id": default_base.id},
        )
        session.commit()


def _migrate_schema_columns(target_engine: Engine) -> None:
    if not str(target_engine.url).startswith("sqlite"):
        return
    inspector = inspect(target_engine)
    table_names = set(inspector.get_table_names())
    required_tables = {"knowledge_bases", "learning_runs", "knowledge_nodes", "knowledge_edges", "cards", "sources"}
    if not required_tables.issubset(table_names):
        return
    with target_engine.begin() as connection:
        columns = {column["name"] for column in inspector.get_columns("knowledge_bases")}
        if "learning_prompt" not in columns:
            connection.execute(text("alter table knowledge_bases add column learning_prompt text"))

        for table_name in ("learning_runs", "knowledge_nodes", "knowledge_edges"):
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if "knowledge_base_id" not in columns:
                connection.execute(text(f"alter table {table_name} add column knowledge_base_id integer"))
        columns = {column["name"] for column in inspector.get_columns("learning_runs")}
        if "learning_prompt" not in columns:
            connection.execute(text("alter table learning_runs add column learning_prompt text"))

        for table_name in ("learning_runs", "sources"):
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if "is_pinned" not in columns:
                connection.execute(text(f"alter table {table_name} add column is_pinned boolean default 0 not null"))

        columns = {column["name"] for column in inspector.get_columns("cards")}
        if "approval_status" not in columns:
            connection.execute(text("alter table cards add column approval_status varchar(32) default 'approved' not null"))
        if "candidate_payload" not in columns:
            connection.execute(text("alter table cards add column candidate_payload json"))


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
