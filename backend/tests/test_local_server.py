import importlib

from app.config import Settings


def test_settings_reads_cors_origins_from_env_string(monkeypatch):
    monkeypatch.setenv(
        "AILKG_CORS_ORIGINS",
        "http://localhost, http://127.0.0.1, capacitor://localhost",
    )

    settings = Settings()

    assert settings.cors_origins == [
        "http://localhost",
        "http://127.0.0.1",
        "capacitor://localhost",
    ]


def test_local_server_builds_sqlite_database_url(tmp_path, monkeypatch):
    monkeypatch.setenv("AILKG_DATA_DIR", str(tmp_path))
    local_server = importlib.import_module("app.local_server")

    settings = local_server.build_local_server_settings(port=43125)

    assert settings.host == "127.0.0.1"
    assert settings.port == 43125
    assert settings.database_url == f"sqlite:///{tmp_path / 'knowledge.db'}"
    assert settings.secret_file == tmp_path / "secrets.json"
