import jwt
from django.conf import settings
from datetime import datetime, timedelta
from uuid import UUID

ACCESS_TOKEN_LIFETIME_MINUTES = 60
REFRESH_TOKEN_LIFETIME_DAYS = 7


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


def make_refresh_token(user_id: UUID, session_id: UUID | str | None = None) -> str:
    payload = {
        "user_id": str(user_id),
        "type": "refresh",
        "exp": datetime.utcnow() + timedelta(days=REFRESH_TOKEN_LIFETIME_DAYS),
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
