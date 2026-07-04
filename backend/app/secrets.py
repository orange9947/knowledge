import json
import os
from pathlib import Path


DEFAULT_SECRET_FILE = "data/secrets.json"


class SecretStore:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.environ.get("AILKG_SECRET_FILE", DEFAULT_SECRET_FILE))

    def put(self, name: str, value: str) -> str:
        key = self._key(name)
        payload = self._load()
        payload[key] = value
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.path.chmod(0o600)
        return key

    def get(self, reference: str | None) -> str | None:
        if not reference:
            return None
        return self._load().get(reference)

    def _load(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(key): str(value) for key, value in data.items()}

    def _key(self, name: str) -> str:
        normalized = name.strip().lower().replace(" ", "_") or "default"
        return f"model:{normalized}:api_key"
