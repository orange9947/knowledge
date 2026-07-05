import os
import threading
import traceback


_server_thread = None
_startup_error = None


def start(data_dir: str, port: int) -> None:
    global _server_thread, _startup_error
    if _server_thread and _server_thread.is_alive():
        return

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
            from app.local_server import run_local_server

            run_local_server(port=port)
        except Exception:
            _startup_error = traceback.format_exc()
            print(_startup_error, flush=True)

    _startup_error = None
    _server_thread = threading.Thread(target=run, daemon=True)
    _server_thread.start()


def startup_error() -> str | None:
    return _startup_error
