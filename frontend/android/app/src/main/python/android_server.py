import os
import threading


_server_thread = None


def start(data_dir: str, port: int) -> None:
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return

    os.environ["AILKG_DATA_DIR"] = data_dir
    os.environ["AILKG_DATABASE_URL"] = f"sqlite:///{data_dir}/knowledge.db"
    os.environ["AILKG_SECRET_FILE"] = f"{data_dir}/secrets.json"
    os.environ["AILKG_HOST"] = "127.0.0.1"
    os.environ["AILKG_PORT"] = str(port)
    os.environ["AILKG_CORS_ORIGINS"] = "http://localhost,http://127.0.0.1,capacitor://localhost"

    from app.local_server import run_local_server

    _server_thread = threading.Thread(target=run_local_server, kwargs={"port": port}, daemon=True)
    _server_thread.start()
