"""Backend tests: storage, the access gate, per-user data, and the AI endpoint's translation to Gemini. No network."""

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
from server import app as app_module
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
    assert client.get("/exercises/Leg_Press-0.webp").status_code == 401
    assert client.get("/exercises/Leg_Press-0.webp", headers=sign("haim@example.com")).headers["content-type"] == "image/webp"


def test_each_user_sees_only_their_own_data(data_file: Path, sign) -> None:
    client = client_for(data_file, iap_audience=AUDIENCE)
    haim, dana = sign("Haim@Example.com"), sign("dana@example.com")
    assert client.put("/api/storage/gymbot:workouts", content='["haim"]', headers=haim).status_code == 204
    assert client.get("/api/storage/gymbot:workouts", headers=dana).status_code == 404
    assert client.put("/api/storage/gymbot:workouts", content='["dana"]', headers=dana).status_code == 204
    assert client.get("/api/storage/gymbot:workouts", headers=haim).json() == ["haim"]
    assert json.loads((data_file.parent / "haim@example.com.json").read_text()) == {"gymbot:workouts": ["haim"]}


def test_ask_answers_with_text_and_reports_failures(data_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = client_for(data_file)
    monkeypatch.setattr(gemini, "answer", lambda question: gemini.Reply(f"echo {question.messages[0].content}"))
    body = {"system": "Coach", "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/api/ask", json=body).json() == {"text": "echo hi"}
    assert client.post("/api/ask", json={"system": "Coach", "messages": [{"role": "robot", "content": "hi"}]}).status_code == 422

    def fail(question: gemini.Question) -> gemini.Reply:
        raise gemini.EmptyReplyError("blocked")

    monkeypatch.setattr(gemini, "answer", fail)
    assert client.post("/api/ask", json=body).status_code == 502


def test_ask_stops_at_the_daily_limit_and_logs_each_call(
    data_file: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_for(data_file)
    monkeypatch.setattr(app_module, "AI_CALLS_PER_DAY", 2)
    monkeypatch.setattr(gemini, "answer", lambda question: gemini.Reply("ok", input_tokens=120, output_tokens=30))
    body = {"system": "You are GymBot", "messages": [{"role": "user", "content": "hi"}]}
    with caplog.at_level("INFO"):
        assert [client.post("/api/ask", json=body).status_code for _ in range(3)] == [200, 200, 429]
    assert client.post("/api/ask", json=body).text == app_module.AI_LIMIT_MESSAGE
    assert "AI call: user=dev prompt='You are GymBot' tokens_in=120 tokens_out=30" in caplog.text


def test_requests_over_the_size_limit_are_refused(data_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = client_for(data_file)
    monkeypatch.setattr(app_module, "MAX_REQUEST_BYTES", 100)
    assert client.put("/api/storage/x", content=json.dumps("a" * 200)).status_code == 413
    assert client.put("/api/storage/x", content=json.dumps("a" * 50)).status_code == 204


def test_app_files_are_checked_for_a_new_version_on_each_load(data_file: Path) -> None:
    client = client_for(data_file)
    picture = client.get("/exercises/Leg_Press-0.webp")
    assert picture.headers["cache-control"] == "no-cache"
    assert client.get("/exercises/Leg_Press-0.webp", headers={"if-none-match": picture.headers["etag"]}).status_code == 304
    assert "cache-control" not in client.get("/api/storage/gymbot:workouts").headers


def test_the_page_links_a_manifest_that_installs_the_app(data_file: Path) -> None:
    client = client_for(data_file)
    assert 'href="/static/manifest.webmanifest"' in client.get("/").text
    manifest = client.get("/static/manifest.webmanifest")
    assert manifest.headers["content-type"] == "application/manifest+json"
    assert (manifest.json()["start_url"], manifest.json()["display"]) == ("/", "standalone")
    sizes = {icon["sizes"] for icon in manifest.json()["icons"]}
    assert {"192x192", "512x512"} <= sizes  # what Android needs to install it
    for icon in manifest.json()["icons"]:
        assert client.get(icon["src"]).status_code == 200


def test_gemini_contents_from_the_conversation() -> None:
    jpeg = b"\xff\xd8 fake jpeg"
    contents = gemini.to_gemini_contents(
        [
            gemini.Message("user", "How was my bench?"),
            gemini.Message("assistant", "Solid."),
            gemini.Message("user", "Check my form", images=[base64.b64encode(jpeg).decode()]),
        ]
    )
    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].text == "Solid."
    image, text = contents[2].parts
    assert (image.inline_data.mime_type, image.inline_data.data, text.text) == ("image/jpeg", jpeg, "Check my form")
