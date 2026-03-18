import jwt
from django.conf import settings
from datetime import datetime, timedelta
from uuid import UUID

ACCESS_TOKEN_LIFETIME_MINUTES = 60
# Web: same as REFRESH_COOKIE_MAX_AGE_DAYS (cookie + JWT expiry). App: 1 year.
REFRESH_TOKEN_LIFETIME_APP_DAYS = 365  # десктоп, приложение на телефон — 1 год


def _refresh_lifetime_web_days() -> int:
    """Refresh token lifetime for web (must match cookie max_age)."""
    return getattr(settings, "REFRESH_COOKIE_MAX_AGE_DAYS", 30)


def make_access_token(user_id: UUID, session_id: UUID | str | None = None) -> str:
    payload = {
        "user_id": str(user_id),
        "type": "access",
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_LIFETIME_MINUTES),
        "iat": datetime.utcnow(),
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def make_refresh_token(
    user_id: UUID,
    session_id: UUID | str | None = None,
    client_type: str = "web",
) -> str:
    """Create refresh token. client_type: 'web' -> REFRESH_COOKIE_MAX_AGE_DAYS, 'android'|'desktop' -> 1 year."""
    days = (
        REFRESH_TOKEN_LIFETIME_APP_DAYS
        if client_type in ("android", "desktop")
        else _refresh_lifetime_web_days()
    )
    payload = {
        "user_id": str(user_id),
        "type": "refresh",
        "exp": datetime.utcnow() + timedelta(days=days),
        "iat": datetime.utcnow(),
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
