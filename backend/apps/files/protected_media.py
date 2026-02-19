"""
Protected media serving (avatars, chat backgrounds).
HMAC-signed URLs — cannot be guessed by brute force.
Access check: only authenticated users with permission to view the content.
"""
import hashlib
import hmac
import time
from urllib.parse import quote

from django.conf import settings

MEDIA_TOKEN_TTL = 60 * 60  # 1 hour


def _normalize_path(path: str) -> str:
    """Normalizes path by stripping leading / and media/ prefix."""
    p = (path or "").strip().replace("\\", "/")
    while p.startswith("/"):
        p = p[1:]
    for prefix in ("media/", "media"):
        if p.startswith(prefix):
            p = p[len(prefix):].lstrip("/")
            break
    return p


def make_protected_media_token(path: str, expires_at: int | None = None) -> str:
    """Generates an HMAC token for the path. Without knowing path and SECRET_KEY, guessing is impossible."""
    path = _normalize_path(path)
    if not path:
        return ""
    if expires_at is None:
        expires_at = int(time.time()) + MEDIA_TOKEN_TTL
    payload = f"{path}:{expires_at}"
    sig = hmac.new(
        settings.SECRET_KEY.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{expires_at}.{sig}"


def verify_protected_media_token(path: str, token: str) -> bool:
    """Verifies the token signature and expiration."""
    path = _normalize_path(path)
    if not path or not token:
        return False
    try:
        expires_raw, sig = token.split(".", 1)
        expires_at = int(expires_raw)
    except (ValueError, TypeError):
        return False
    if expires_at < int(time.time()):
        return False
    payload = f"{path}:{expires_at}"
    expected = hmac.new(
        settings.SECRET_KEY.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, sig)


def make_protected_media_url(path: str, request=None, base_url: str | None = None) -> str | None:
    """
    Returns a full URL for protected media with a token.
    path: path from ImageField (e.g. avatars/xxx.jpg or /media/avatars/xxx.jpg).
    base_url: when request is absent — base URL (e.g. from settings.FRONTEND_URL).
    """
    path = _normalize_path(path)
    if not path:
        return None
    token = make_protected_media_token(path)
    base = "/api/media/serve/"
    query = f"path={quote(path, safe='')}&t={token}"
    full_path = f"{base}?{query}"
    if request and getattr(request, "build_absolute_uri", None):
        try:
            return request.build_absolute_uri(full_path)
        except Exception:
            pass
    if base_url:
        return f"{base_url.rstrip('/')}/{full_path.lstrip('/')}"
    return full_path
