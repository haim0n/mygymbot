"""Run the server: ``uv run python -m server``.

Settings come from the environment:

- ``PORT`` (default 5173) and ``HOST`` (default 127.0.0.1: this machine only).
- ``GYMBOT_DATA_DIR``: where the data lives, one ``<user>.json`` per user (default ``data/``).
- ``GYMBOT_IAP_AUDIENCE``: the service's IAP audience, ``/projects/<number>/locations/<region>/services/<name>``.
  Required on any other ``HOST``, since whoever reaches the server can use the AI and the data. Without it
  there is one user, ``dev``.
- ``GYMBOT_COMMIT``: the git commit this copy was deployed from (set by ``npm run deploy``), shown in the app.
"""

import logging
import os
from pathlib import Path

import uvicorn

from server.app import create_app
from server.storage import Stores

ROOT = Path(__file__).resolve().parent.parent
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def main() -> None:
    """Start the server, refusing to listen beyond this machine without IAP."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")  # the AI usage lines are INFO
    host = os.environ.get("HOST", "127.0.0.1")
    iap_audience = os.environ.get("GYMBOT_IAP_AUDIENCE", "").strip() or None
    if iap_audience is None and host not in LOOPBACK_HOSTS:
        raise SystemExit(f"Listening on {host} needs GYMBOT_IAP_AUDIENCE")
    data_dir = Path(os.environ.get("GYMBOT_DATA_DIR", ROOT / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    print(f"GymBot data: {data_dir}")
    uvicorn.run(create_app(Stores(data_dir), iap_audience, os.environ.get("GYMBOT_COMMIT")), host=host, port=int(os.environ.get("PORT", "5173")))


if __name__ == "__main__":
    main()
