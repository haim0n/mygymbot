"""Run the server: ``uv run python -m server``.

Settings come from the environment:

- ``PORT`` (default 5173) and ``HOST`` (default 127.0.0.1: this machine only).
- ``GYMBOT_DATA_FILE``: where the data lives (default ``data/dev.json``).
- ``GYMBOT_ACCESS_KEY``: required on any other ``HOST``, since whoever reaches the server can use the AI and the data.
"""

import os
from pathlib import Path

import uvicorn

from server.app import create_app
from server.storage import Store

ROOT = Path(__file__).resolve().parent.parent
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def main() -> None:
    """Start the server, refusing to listen beyond this machine without an access key."""
    host = os.environ.get("HOST", "127.0.0.1")
    access_key = os.environ.get("GYMBOT_ACCESS_KEY", "").strip() or None
    if access_key is None and host not in LOOPBACK_HOSTS:
        raise SystemExit(f"Listening on {host} needs GYMBOT_ACCESS_KEY")
    data_file = Path(os.environ.get("GYMBOT_DATA_FILE", ROOT / "data" / "dev.json"))
    print(f"GymBot data: {data_file}")
    uvicorn.run(create_app(Store.open(data_file), access_key), host=host, port=int(os.environ.get("PORT", "5173")))


if __name__ == "__main__":
    main()
