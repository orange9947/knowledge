from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
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

    Base.metadata.create_all(bind=target_engine or engine)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
