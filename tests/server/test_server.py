"""Backend tests: storage, the access gate, per-user data, and the translation to and from Gemini. No network."""

import base64
import json
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from google.auth import crypt, jwt

from server import gemini, iap
from server.app import create_app
from server.storage import Store, Stores

AUDIENCE = "/projects/1/locations/me-west1/services/gymbot"


@pytest.fixture
def data_file(tmp_path: Path) -> Path:
    return tmp_path / "dev.json"


def client_for(data_file: Path, iap_audience: str | None = None) -> TestClient:
    return TestClient(create_app(Stores(data_file.parent), iap_audience))


@pytest.fixture
def sign(monkeypatch: pytest.MonkeyPatch):
    """Sign IAP-style tokens with a test key that ``iap`` trusts instead of Google's."""
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public_pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    monkeypatch.setattr(iap, "_fetch_certs", lambda: {"test": public_pem.decode()})
    monkeypatch.setattr(iap, "_certs", {})
    monkeypatch.setattr(iap, "_certs_fetched_at", float("-inf"))
    signer = crypt.ES256Signer.from_string(private_pem, key_id="test")

    def signed(email: str, audience: str = AUDIENCE, issuer: str = iap.IAP_ISSUER) -> dict[str, str]:
        now = int(time.time())
        claims = {"email": email, "aud": audience, "iss": issuer, "iat": now, "exp": now + 600}
        return {iap.IAP_HEADER: jwt.encode(signer, claims).decode()}

    return signed


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


def test_only_iap_signed_requests_get_in(data_file: Path, sign) -> None:
    client = client_for(data_file, iap_audience=AUDIENCE)
    assert client.get("/").status_code == 401
    assert client.get("/", headers={iap.IAP_HEADER: "not a token"}).status_code == 401
    assert client.get("/", headers=sign("haim@example.com", audience="/projects/1/other")).status_code == 401
    assert client.get("/", headers=sign("haim@example.com", issuer="https://evil.example")).status_code == 401
    assert client.get("/", headers=sign("../haim@example.com")).status_code == 401
    assert client.get("/", headers=sign("haim@example.com")).status_code == 200


def test_each_user_sees_only_their_own_data(data_file: Path, sign) -> None:
    client = client_for(data_file, iap_audience=AUDIENCE)
    haim, dana = sign("Haim@Example.com"), sign("dana@example.com")
    assert client.put("/api/storage/gymbot:workouts", content='["haim"]', headers=haim).status_code == 204
    assert client.get("/api/storage/gymbot:workouts", headers=dana).status_code == 404
    assert client.put("/api/storage/gymbot:workouts", content='["dana"]', headers=dana).status_code == 204
    assert client.get("/api/storage/gymbot:workouts", headers=haim).json() == ["haim"]
    assert json.loads((data_file.parent / "haim@example.com.json").read_text()) == {"gymbot:workouts": ["haim"]}


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
