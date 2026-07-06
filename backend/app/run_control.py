from __future__ import annotations

from datetime import datetime
from threading import Event, Lock


class RunPauseRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._events: dict[int, tuple[datetime | None, Event]] = {}

    def reset(self, run_id: int) -> None:
        with self._lock:
            self._events.pop(run_id, None)

    def request_pause(self, run_id: int, created_at: datetime | None = None) -> None:
        with self._lock:
            stored = self._events.get(run_id)
            if stored is None or stored[0] != created_at:
                event = Event()
                self._events[run_id] = (created_at, event)
            else:
                event = stored[1]
            event.set()

    def is_pause_requested(self, run_id: int, created_at: datetime | None = None) -> bool:
        with self._lock:
            stored = self._events.get(run_id)
        if stored is None:
            return False
        stored_created_at, event = stored
        if stored_created_at != created_at:
            return False
        return bool(event and event.is_set())

    def clear(self, run_id: int) -> None:
        self.reset(run_id)


run_pause_registry = RunPauseRegistry()
