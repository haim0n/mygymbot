"""The web server: the app's page and bundle, its per-user storage API, its AI endpoint, all behind IAP."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from server import gemini, iap
from server.storage import Stores

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEV_USER = "dev"  # the only user without IAP (local dev); data in data/dev.json

logger = logging.getLogger(__name__)


def create_app(stores: Stores, iap_audience: str | None) -> FastAPI:
    """Build the server around each user's ``stores``.

    With ``iap_audience`` set, every request must carry IAP's signed identity for this service, and the
    signed-in email decides whose data the storage API uses. Without it, everyone is the single user ``dev``.
    """
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def identify_user(request: Request, call_next: Any) -> Response:
        if iap_audience is None:
            request.state.user = DEV_USER
            return await call_next(request)
        try:
            token = request.headers.get(iap.IAP_HEADER)
            request.state.user = await asyncio.to_thread(iap.user_email, token, iap_audience)
        except iap.NotSignedIn as error:
            logger.warning("Refused a request without IAP identity: %s", error)
            return PlainTextResponse("Sign in through GymBot's address.", status_code=401)
        return await call_next(request)

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/api/storage/{key:path}")
    def read_value(key: str, request: Request) -> Response:
        try:
            value = stores.for_user(request.state.user).get(key)
        except KeyError:
            return Response(status_code=404)  # the app reads this as "nothing stored yet"
        return Response(json.dumps(value), media_type="application/json")

    @app.put("/api/storage/{key:path}")
    async def write_value(key: str, request: Request) -> Response:
        try:
            value = json.loads(await request.body())  # the app only stores JSON; parsing keeps the file readable
        except json.JSONDecodeError:
            return PlainTextResponse("Value must be JSON", status_code=400)
        await asyncio.to_thread(stores.for_user(request.state.user).set, key, value)
        return Response(status_code=204)

    @app.delete("/api/storage/{key:path}")
    async def delete_value(key: str, request: Request) -> Response:
        await asyncio.to_thread(stores.for_user(request.state.user).delete, key)
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
