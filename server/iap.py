"""Who is asking: the signed-in Google account that Identity-Aware Proxy (IAP) let through.

IAP in front of Cloud Run signs every request it forwards (``x-goog-iap-jwt-assertion``). Checking the
signature, rather than trusting a plain header, means a request that didn't come through IAP gets nothing.
Who may get through is IAP's access list (IAM), not this code.
"""

import json
import re
import threading
import time
import urllib.request

from google.auth import jwt

IAP_HEADER = "x-goog-iap-jwt-assertion"
IAP_ISSUER = "https://cloud.google.com/iap"
IAP_CERTS_URL = "https://www.gstatic.com/iap/verify/public_key"
CERTS_MAX_AGE = 3600  # seconds; keys rotate, and an unknown key ID refreshes them sooner
CERTS_MIN_AGE = 60  # seconds; forged key IDs can't make us fetch more often than this
EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+")  # emails name the data files, so nothing path-like

_certs: dict[str, str] = {}
_certs_fetched_at = float("-inf")  # never fetched
_certs_lock = threading.Lock()


class NotSignedIn(Exception):
    """The request carries no valid IAP identity."""


def _fetch_certs() -> dict[str, str]:
    """IAP's current public keys, ``{key ID: PEM}``."""
    with urllib.request.urlopen(IAP_CERTS_URL, timeout=10) as response:
        return json.load(response)


def _certs_for(key_id: str) -> dict[str, str]:
    """Cached public keys, refreshed when old or when ``key_id`` is new to us."""
    global _certs, _certs_fetched_at
    with _certs_lock:
        max_age = CERTS_MAX_AGE if key_id in _certs else CERTS_MIN_AGE
        if time.monotonic() - _certs_fetched_at > max_age:
            _certs, _certs_fetched_at = _fetch_certs(), time.monotonic()
        return _certs


def user_email(token: str | None, audience: str) -> str:
    """The lowercase email of the account IAP signed ``token`` for; raises ``NotSignedIn`` otherwise."""
    if not token:
        raise NotSignedIn("no IAP token")
    try:
        key_id = jwt.decode_header(token).get("kid", "")
        claims = jwt.decode(token, certs=_certs_for(key_id), audience=audience)
    except ValueError as error:
        raise NotSignedIn(str(error)) from error
    email = str(claims.get("email", "")).lower()
    if claims.get("iss") != IAP_ISSUER or not EMAIL.fullmatch(email):
        raise NotSignedIn("not an IAP identity")
    return email
