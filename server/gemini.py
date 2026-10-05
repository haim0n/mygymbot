"""Answers the app's AI requests with Gemini on Vertex AI.

The app (``src/gymbot.jsx``) speaks the Anthropic Messages format, because it also runs as a claude.ai
artifact. This module translates both ways, so the app itself doesn't change.
"""

import base64
from functools import cache
from typing import Any

import google.auth
from google import genai
from google.auth.exceptions import DefaultCredentialsError
from google.genai import types

GCP_PROJECT = "mygymbot"  # the only GCP project GymBot uses
GEMINI_LOCATION = "global"
GEMINI_MODEL = "gemini-3.8-flash"
# The app asks for 1000 tokens (an artifact limit); Gemini's thinking needs room on top of the answer.
MAX_OUTPUT_TOKENS = 4096
THINKING_LEVEL = "low"  # the lowest this model accepts; replies come back between sets
PLACEHOLDER_REPLY = "(Dev mode: no Google credentials. Run `gcloud auth application-default login` for real coach replies.)"


class EmptyReplyError(RuntimeError):
    """Gemini returned no text, for example when a safety filter stopped the answer."""


def to_gemini_contents(messages: list[dict[str, Any]]) -> list[types.Content]:
    """Convert Anthropic-style messages (text and base64 image blocks) to Gemini contents."""
    return [
        types.Content(role="model" if message["role"] == "assistant" else "user", parts=_parts(message["content"]))
        for message in messages
    ]


def _parts(content: str | list[dict[str, Any]]) -> list[types.Part]:
    """Convert one message's content, a string or a list of blocks, to Gemini parts."""
    if isinstance(content, str):
        return [types.Part.from_text(text=content)]
    parts = []
    for block in content:
        if block["type"] == "image":
            source = block["source"]
            parts.append(types.Part.from_bytes(data=base64.b64decode(source["data"]), mime_type=source["media_type"]))
        else:
            parts.append(types.Part.from_text(text=block["text"]))
    return parts


def claude_reply(text: str) -> dict[str, Any]:
    """Wrap ``text`` the way the Anthropic API answers, which is what the app reads."""
    return {"content": [{"type": "text", "text": text}]}


@cache
def _client() -> genai.Client | None:
    """Vertex AI client billed to ``mygymbot``, or ``None`` without Google credentials (local dev).

    The quota project is set explicitly so local credentials never bill another project.
    """
    try:
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"], quota_project_id=GCP_PROJECT
        )
    except DefaultCredentialsError:
        return None
    return genai.Client(vertexai=True, project=GCP_PROJECT, location=GEMINI_LOCATION, credentials=credentials)


def answer(body: dict[str, Any]) -> dict[str, Any]:
    """Answer an Anthropic Messages request body with Gemini, in the Anthropic reply shape."""
    client = _client()
    if client is None:
        return claude_reply(PLACEHOLDER_REPLY)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=to_gemini_contents(body["messages"]),
        config=types.GenerateContentConfig(
            system_instruction=body.get("system") or None,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),  # no tools
        ),
    )
    if not response.text:
        raise EmptyReplyError(f"Gemini returned no text (finish reason: {response.candidates[0].finish_reason})")
    return claude_reply(response.text)
