"""Answers the app's AI requests (``POST /api/ask``) with Gemini on Vertex AI."""

import base64
from dataclasses import dataclass, field
from functools import cache
from typing import Literal

import google.auth
from google import genai
from google.auth.exceptions import DefaultCredentialsError
from google.genai import types

GCP_PROJECT = "mygymbot"  # the only GCP project GymBot uses
GEMINI_LOCATION = "global"
GEMINI_MODEL = "gemini-3.8-flash"
MAX_OUTPUT_TOKENS = 4096  # thinking takes roughly 300 to 500 of these on top of the answer
THINKING_LEVEL = "low"  # the lowest this model accepts; replies come back between sets
PLACEHOLDER_REPLY = "(Dev mode: no Google credentials. Run `gcloud auth application-default login` for real coach replies.)"


class EmptyReplyError(RuntimeError):
    """Gemini returned no text, for example when a safety filter stopped the answer."""


@dataclass
class Message:
    """One turn of the conversation, with any images (form-check frames, screenshots) as base64 JPEG."""

    role: Literal["user", "assistant"]
    content: str
    images: list[str] = field(default_factory=list)


@dataclass
class Reply:
    """Gemini's answer and what it cost, in tokens (output includes thinking)."""

    text: str
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class Question:
    """What the app asks: the instructions, then the conversation so far."""

    system: str
    messages: list[Message]


def to_gemini_contents(messages: list[Message]) -> list[types.Content]:
    """Gemini's form of the conversation: each turn's images, then its text."""
    return [
        types.Content(
            role="model" if message.role == "assistant" else "user",
            parts=[
                *(types.Part.from_bytes(data=base64.b64decode(image), mime_type="image/jpeg") for image in message.images),
                types.Part.from_text(text=message.content),
            ],
        )
        for message in messages
    ]


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


def answer(question: Question) -> Reply:
    """Gemini's reply to ``question``."""
    client = _client()
    if client is None:
        return Reply(PLACEHOLDER_REPLY)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=to_gemini_contents(question.messages),
        config=types.GenerateContentConfig(
            system_instruction=question.system or None,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),  # no tools
        ),
    )
    if not response.text:
        raise EmptyReplyError(f"Gemini returned no text (finish reason: {response.candidates[0].finish_reason})")
    usage = response.usage_metadata
    return Reply(
        response.text,
        input_tokens=usage.prompt_token_count or 0,
        output_tokens=(usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0),
    )
