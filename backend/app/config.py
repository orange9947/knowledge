from functools import lru_cache
import os
from pathlib import Path

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class _SettingsBase(BaseSettings):
        model_config = SettingsConfigDict(env_prefix="AILKG_", env_file=".env", enable_decoding=False)

except ImportError:
    from pydantic import BaseSettings

    class _SettingsBase(BaseSettings):
        class Config:
            env_prefix = "AILKG_"
            env_file = ".env"


class Settings(_SettingsBase):
    app_name: str = "AI 学习知识图谱"
    app_version: str = "0.1.0"
    database_url: str = "sqlite:///./data/knowledge.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    def __init__(self, **values):
        env_origins = os.environ.get("AILKG_CORS_ORIGINS")
        if env_origins and "cors_origins" not in values:
            values["cors_origins"] = [item.strip() for item in env_origins.split(",") if item.strip()]
        super().__init__(**values)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_sqlite_parent(database_url: str) -> None:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return
    path = database_url.removeprefix(prefix)
    if path in (":memory:", ""):
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
