from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import uvicorn


@dataclass(frozen=True)
class LocalServerSettings:
    host: str
    port: int
    data_dir: Path
    database_url: str
    secret_file: Path


def build_local_server_settings(port: int | None = None) -> LocalServerSettings:
    data_dir = Path(os.environ.get("AILKG_DATA_DIR", "data")).expanduser().resolve()
    database_url = os.environ.get("AILKG_DATABASE_URL", f"sqlite:///{data_dir / 'knowledge.db'}")
    secret_file = Path(os.environ.get("AILKG_SECRET_FILE", data_dir / "secrets.json")).expanduser().resolve()
    return LocalServerSettings(
        host=os.environ.get("AILKG_HOST", "127.0.0.1"),
        port=port or int(os.environ.get("AILKG_PORT", "8000")),
        data_dir=data_dir,
        database_url=database_url,
        secret_file=secret_file,
    )


def apply_local_server_environment(settings: LocalServerSettings) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["AILKG_DATABASE_URL"] = settings.database_url
    os.environ["AILKG_SECRET_FILE"] = str(settings.secret_file)


def run_local_server(port: int | None = None) -> None:
    settings = build_local_server_settings(port)
    apply_local_server_environment(settings)
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False, access_log=False)


def start_local_server_thread(port: int | None = None) -> threading.Thread:
    thread = threading.Thread(target=run_local_server, kwargs={"port": port}, daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    run_local_server()
