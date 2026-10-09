"""The web server: the app's page and bundle, its per-user storage API, its AI endpoint, all behind IAP."""

import asyncio
import html
import json
import logging
import threading
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from server import gemini, iap
from server.storage import Stores

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEV_USER = "dev"  # the only user without IAP (local dev); data in data/dev.json

logger = logging.getLogger(__name__)
STATIC_PATHS = ("/dist/", "/exercises/", "/static/")  # the bundle, the pictures and the install files, replaced in place by each deploy
AI_CALLS_PER_DAY = 200  # per user: several times a heavy training day, low enough to stop a runaway loop or misuse
MAX_REQUEST_BYTES = 16_000_000  # a screenshot import (up to 8 image slices) is about 3 MB
FEEDBACK_FILE = "feedback.jsonl"  # every user's feedback, one JSON line each, next to the users' files
MAX_FEEDBACK_CHARS = 5000
MAX_ERROR_REPORT_CHARS = 2000  # a stack trace fits; a flood doesn't
AI_LIMIT_MESSAGE = "You've reached today's limit for the coach. It resets tomorrow."


@dataclass
class AppError:
    """An uncaught error in the app on someone's phone."""

    message: str
    version: str = ""


@dataclass
class Feedback:
    """A message from a user to whoever runs GymBot."""

    text: str
    version: str = ""


def create_app(stores: Stores, iap_audience: str | None, commit: str | None = None) -> FastAPI:
    """Build the server around each user's ``stores``.

    With ``iap_audience`` set, every request must carry IAP's signed identity for this service, and the
    signed-in email decides whose data the storage API uses. Without it, everyone is the single user ``dev``.
    ``commit``, the git commit this copy was deployed from, goes into the page for the app to show.
    """
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    # ponytail: in memory, so it resets on each deploy; fine with one instance. Store it if the limit must hold exactly.
    ai_calls: Counter[tuple[str, date]] = Counter()
    feedback_lock = threading.Lock()
    page = (WEB_DIR / "index.html").read_text()
    if commit:
        page = page.replace("<head>", f'<head>\n    <meta name="gymbot-commit" content="{html.escape(commit)}" />', 1)

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

    @app.middleware("http")
    async def limit_size(request: Request, call_next: Any) -> Response:
        if int(request.headers.get("content-length", 0)) > MAX_REQUEST_BYTES:
            return PlainTextResponse("Request too large", status_code=413)
        return await call_next(request)

    @app.middleware("http")
    async def revalidate_files(request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        if request.url.path.startswith(STATIC_PATHS):
            # Without this, browsers cache by their own rules and kept running an app several deploys old.
            # no-cache still caches, but checks the ETag first: unchanged files cost one 304.
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/")
    def index() -> HTMLResponse:
        return HTMLResponse(page)

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

    @app.post("/api/ask")
    def ask(question: gemini.Question, request: Request) -> Response:
        user = request.state.user
        today = (user, date.today())
        if ai_calls[today] >= AI_CALLS_PER_DAY:
            logger.warning("AI limit reached for %s", user)
            return PlainTextResponse(AI_LIMIT_MESSAGE, status_code=429)
        ai_calls[today] += 1
        try:
            reply = gemini.answer(question)
        except Exception as error:  # any Gemini failure: the app then shows "the coach didn't respond"
            logger.exception("Gemini request failed")
            return JSONResponse({"error": str(error)}, status_code=502)
        # One line per call, to measure the cost per user and per prompt.
        logger.info(
            "AI call: user=%s prompt=%r tokens_in=%d tokens_out=%d",
            user, question.system[:40], reply.input_tokens, reply.output_tokens,
        )
        return JSONResponse({"text": reply.text})

    @app.post("/api/errors")
    def report_error(report: AppError, request: Request) -> Response:
        logger.error("App error for %s (app %s): %s", request.state.user, report.version, report.message[:MAX_ERROR_REPORT_CHARS])
        return Response(status_code=204)

    @app.post("/api/feedback")
    def keep_feedback(feedback: Feedback, request: Request) -> Response:
        entry = {
            "time": datetime.now(UTC).isoformat(timespec="seconds"),
            "user": request.state.user,
            "version": feedback.version,
            "text": feedback.text[:MAX_FEEDBACK_CHARS],
        }
        with feedback_lock, (stores.directory / FEEDBACK_FILE).open("a") as file:
            file.write(json.dumps(entry) + "\n")
        logger.info("Feedback from %s", request.state.user)
        return Response(status_code=204)

    app.mount("/dist", StaticFiles(directory=WEB_DIR / "dist", check_dir=False), name="dist")
    app.mount("/exercises", StaticFiles(directory=WEB_DIR / "exercises"), name="exercises")
    app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")  # what installs it on a phone
    return app
