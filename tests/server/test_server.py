"""Backend tests: storage, the access gate, and the translation to and from Gemini. No network."""

import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import gemini
from server.app import ACCESS_COOKIE, create_app
from server.storage import Store


@pytest.fixture
def data_file(tmp_path: Path) -> Path:
    return tmp_path / "gymbot.json"


def client_for(data_file: Path, access_key: str | None = None) -> TestClient:
    return TestClient(create_app(Store.open(data_file), access_key), base_url="https://testserver")


def test_storage_round_trip_saves_readable_json(data_file: Path) -> None:
    client = client_for(data_file)
    assert client.get("/api/storage/gymbot:workouts").status_code == 404
    assert client.put("/api/storage/gymbot:workouts", content='[{"id": "a"}]').status_code == 204
    assert client.get("/api/storage/gymbot:workouts").json() == [{"id": "a"}]
    assert json.loads(data_file.read_text()) == {"gymbot:workouts": [{"id": "a"}]}
    assert client.put("/api/storage/x", content="not json").status_code == 400
    assert client.delete("/api/storage/gymbot:workouts").status_code == 204
    assert client.get("/api/storage/gymbot:workouts").status_code == 404


def test_storage_backs_up_once_a_day_and_refuses_a_corrupt_file(data_file: Path) -> None:
    data_file.write_text('{"gymbot:chat": []}')
    Store.open(data_file).set("gymbot:chat", [{"role": "user", "content": "hi"}])
    Store.open(data_file)  # a second start the same day keeps the first backup
    backups = list((data_file.parent / "backups").iterdir())
    assert len(backups) == 1 and json.loads(backups[0].read_text()) == {"gymbot:chat": []}

    data_file.write_text("{broken")
    with pytest.raises(json.JSONDecodeError):
        Store.open(data_file)
    assert data_file.read_text() == "{broken"


def test_access_gate(data_file: Path) -> None:
    client = client_for(data_file, access_key="secret")
    assert client.get("/api/storage/gymbot:workouts").status_code == 401
    assert client.get("/?key=wrong", follow_redirects=False).status_code == 401

    response = client.get("/?key=secret", follow_redirects=False)
    assert response.status_code == 302 and response.headers["location"] == "/"
    assert client.cookies.get(ACCESS_COOKIE) == "secret"
    assert client.get("/api/storage/gymbot:workouts").status_code == 404  # past the gate


def test_messages_answers_in_the_claude_shape_and_reports_failures(data_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = client_for(data_file)
    monkeypatch.setattr(gemini, "answer", lambda body: gemini.claude_reply(f"echo {body['messages'][0]['content']}"))
    body = {"model": "claude-sonnet-4-6", "max_tokens": 1000, "system": "Coach", "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/api/messages", json=body).json() == {"content": [{"type": "text", "text": "echo hi"}]}

    def fail(body: dict) -> dict:
        raise gemini.EmptyReplyError("blocked")

    monkeypatch.setattr(gemini, "answer", fail)
    assert client.post("/api/messages", json=body).status_code == 502


def test_gemini_contents_from_claude_messages() -> None:
    jpeg = b"\xff\xd8 fake jpeg"
    contents = gemini.to_gemini_contents(
        [
            {"role": "user", "content": "How was my bench?"},
            {"role": "assistant", "content": "Solid."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Check my form"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}},
                ],
            },
        ]
    )
    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].text == "Solid."
    image = contents[2].parts[1].inline_data
    assert (image.mime_type, image.data) == ("image/jpeg", jpeg)
