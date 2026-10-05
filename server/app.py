"""The web server: the app's page and bundle, its storage API, its AI endpoint and the access gate."""

import asyncio
import json
import logging
import secrets
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from server import gemini
from server.storage import Store

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
ACCESS_COOKIE = "gymbot_access"
COOKIE_MAX_AGE = 400 * 24 * 3600  # 400 days, the longest browsers keep a cookie

logger = logging.getLogger(__name__)


def _is_access_key(candidate: str | None, access_key: str) -> bool:
    """Compare in constant time, so the key can't be guessed from response times."""
    return candidate is not None and secrets.compare_digest(candidate.encode(), access_key.encode())


def create_app(store: Store, access_key: str | None) -> FastAPI:
    """Build the server around ``store``.

    With ``access_key`` set, only browsers that opened the access link (``/?key=<key>``) once get in;
    the key is then kept in a cookie and checked on every request.
    """
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    if access_key:

        @app.middleware("http")
        async def require_access(request: Request, call_next: Any) -> Response:
            if _is_access_key(request.query_params.get("key"), access_key):
                response = RedirectResponse("/", status_code=302)
                response.set_cookie(
                    ACCESS_COOKIE, access_key, max_age=COOKIE_MAX_AGE, httponly=True, secure=True, samesite="lax"
                )
                return response
            if _is_access_key(request.cookies.get(ACCESS_COOKIE), access_key):
                return await call_next(request)
            return PlainTextResponse("Open GymBot with your access link.", status_code=401)

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/api/storage/{key:path}")
    def read_value(key: str) -> Response:
        try:
            value = store.get(key)
        except KeyError:
            return Response(status_code=404)  # the app reads this as "nothing stored yet"
        return Response(json.dumps(value), media_type="application/json")

    @app.put("/api/storage/{key:path}")
    async def write_value(key: str, request: Request) -> Response:
        try:
            value = json.loads(await request.body())  # the app only stores JSON; parsing keeps the file readable
        except json.JSONDecodeError:
            return PlainTextResponse("Value must be JSON", status_code=400)
        await asyncio.to_thread(store.set, key, value)
        return Response(status_code=204)

    @app.delete("/api/storage/{key:path}")
    async def delete_value(key: str) -> Response:
        await asyncio.to_thread(store.delete, key)
        return Response(status_code=204)

    @app.post("/api/messages")
    def messages(body: dict[str, Any]) -> Response:
        try:
            return JSONResponse(gemini.answer(body))
        except Exception as error:  # any Gemini failure: the app then shows "the coach didn't respond"
            logger.exception("Gemini request failed")
            return JSONResponse({"error": str(error)}, status_code=502)

    app.mount("/dist", StaticFiles(directory=WEB_DIR / "dist", check_dir=False), name="dist")
    return app
