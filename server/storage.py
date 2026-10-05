"""The app's ``window.storage`` keys and values, kept in one JSON file."""

import json
import shutil
import threading
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any


@dataclass
class Store:
    """All stored keys as ``{"gymbot:workouts": [...], ...}``, the same shape as the app's Export data."""

    path: Path
    data: dict[str, Any]
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @classmethod
    def open(cls, path: Path) -> "Store":
        """Load the file, or start empty when there is none.

        A corrupt file raises instead of being overwritten. The first copy of each day goes to
        ``backups/`` before any new code touches the data, so a bad change can be undone.
        """
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            return cls(path, {})
        data = json.loads(path.read_text())
        backup = path.parent / "backups" / f"{path.stem}-{date.today().isoformat()}.json"
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, backup)
        return cls(path, data)

    def get(self, key: str) -> Any:
        """Return the value stored under ``key``; raises ``KeyError`` when there is none."""
        return self.data[key]

    def set(self, key: str, value: Any) -> None:
        """Store ``value`` under ``key`` and save."""
        with self._lock:
            self.data[key] = value
            self._save()

    def delete(self, key: str) -> None:
        """Remove ``key`` (if present) and save."""
        with self._lock:
            self.data.pop(key, None)
            self._save()

    def _save(self) -> None:
        """Write through a temporary file, so a crash never leaves half a file."""
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.data, indent=1))
        temporary.replace(self.path)
