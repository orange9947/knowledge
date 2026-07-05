import os
import threading
import traceback
from datetime import datetime


_server_thread = None
_startup_error = None
_status = "idle"


def log(message: str) -> None:
    print(f"AILKG_PY {datetime.now().isoformat(timespec='seconds')} {message}", flush=True)


def set_status(status: str) -> None:
    global _status
    _status = status
    log(status)


def start(data_dir: str, port: int) -> None:
    global _server_thread, _startup_error
    if _server_thread and _server_thread.is_alive():
        set_status("start skipped; server thread is already alive")
        return

    set_status(f"start requested data_dir={data_dir} port={port}")

    os.environ["AILKG_DATA_DIR"] = data_dir
    os.environ["AILKG_DATABASE_URL"] = f"sqlite:///{data_dir}/knowledge.db"
    os.environ["AILKG_SECRET_FILE"] = f"{data_dir}/secrets.json"
    os.environ["AILKG_HOST"] = "127.0.0.1"
    os.environ["AILKG_PORT"] = str(port)
    os.environ["AILKG_CORS_ORIGINS"] = (
        "http://localhost,http://localhost:8080,http://127.0.0.1,"
        "http://127.0.0.1:43126,capacitor://localhost"
    )

    def run() -> None:
        global _startup_error
        try:
            set_status("importing uvicorn and backend app")
            import uvicorn
            from app.local_server import apply_local_server_environment, build_local_server_settings

            settings = build_local_server_settings(port=port)
            apply_local_server_environment(settings)

            set_status(f"binding {settings.host}:{settings.port}")
            config = uvicorn.Config(
                "app.main:app",
                host=settings.host,
                port=settings.port,
                reload=False,
                access_log=False,
                log_level="info",
            )
            server = uvicorn.Server(config)
            set_status("uvicorn server starting")
            server.run()
            set_status("uvicorn server stopped")
        except Exception:
            _startup_error = traceback.format_exc()
            set_status(f"startup failed: {_startup_error}")

    _startup_error = None
    _server_thread = threading.Thread(target=run, daemon=True)
    _server_thread.start()
    set_status("server thread started")


def startup_error() -> str | None:
    return _startup_error


def status() -> str:
    return _status
