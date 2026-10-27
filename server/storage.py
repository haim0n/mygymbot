"""The app's storage keys and values, kept in one JSON file per user."""

import json
import shutil
import threading
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

MAX_USER_DATA_BYTES = 5_000_000  # per user's file; the largest is about 80 KB, and the server keeps every open file in memory


class TooLargeError(ValueError):
    """A write would make the user's file larger than ``MAX_USER_DATA_BYTES``."""


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
        """Store ``value`` under ``key`` and save.

        :raises TooLargeError: when the file would grow over ``MAX_USER_DATA_BYTES``; nothing changes then.
        """
        with self._lock:
            data = {**self.data, key: value}
            text = json.dumps(data, indent=1)  # ASCII, so its length is its size in bytes
            if len(text) > MAX_USER_DATA_BYTES:
                raise TooLargeError(f"{len(text)} bytes, over {MAX_USER_DATA_BYTES}")
            self.data = data
            self._write(text)

    def delete(self, key: str) -> None:
        """Remove ``key`` (if present) and save."""
        with self._lock:
            self.data.pop(key, None)
            self._write(json.dumps(self.data, indent=1))

    def _write(self, text: str) -> None:
        """Write through a temporary file, so a crash never leaves half a file."""
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(text)
        temporary.replace(self.path)


@dataclass
class Stores:
    """One ``Store`` per user, ``<user>.json`` in ``directory``, opened on the user's first request."""

    directory: Path
    _open: dict[str, Store] = field(default_factory=dict, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def for_user(self, user: str) -> Store:
        """The store for ``user``, which must be safe as a file name."""
        with self._lock:
            if user not in self._open:
                self._open[user] = Store.open(self.directory / f"{user}.json")
            return self._open[user]
