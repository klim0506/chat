"""
Защищённая раздача медиа (аватарки, фоны чатов).
URL с подписью HMAC — нельзя подобрать по перебору.
Проверка доступа: только авторизованные пользователи с правом видеть контент.
"""
import hashlib
import hmac
import time
from urllib.parse import quote

from django.conf import settings

MEDIA_TOKEN_TTL = 60 * 60  # 1 час


def _normalize_path(path: str) -> str:
    """Приводит путь к виду без ведущего / и без media/."""
    p = (path or "").strip().replace("\\", "/")
    while p.startswith("/"):
        p = p[1:]
    for prefix in ("media/", "media"):
        if p.startswith(prefix):
            p = p[len(prefix):].lstrip("/")
            break
    return p


def make_protected_media_token(path: str, expires_at: int | None = None) -> str:
    """Генерирует HMAC-токен для пути. Без знания path и SECRET_KEY подбор невозможен."""
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
    """Проверяет подпись и срок действия токена."""
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
    Возвращает полный URL для защищённого медиа с токеном.
    path: путь из ImageField (например, avatars/xxx.jpg или /media/avatars/xxx.jpg).
    base_url: при отсутствии request — базовый URL (например из settings.FRONTEND_URL).
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
