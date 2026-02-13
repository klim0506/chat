import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from channels.db import database_sync_to_async

User = get_user_model()


@database_sync_to_async
def get_user_from_token(token):
    """Decode JWT, validate session, and return (user, session_id) or (None, None)."""
    if not token:
        return None, None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("type") not in (None, "access"):
            return None, None
        user_id = payload.get("user_id")
        if not user_id:
            return None, None
        # Check session is still active (skip for legacy tokens without sid)
        sid = payload.get("sid")
        if sid:
            from apps.users.models import UserSession
            if not UserSession.objects.filter(id=sid, is_active=True).exists():
                return None, None
        user = User.objects.get(pk=user_id)
        return user, sid
    except (jwt.InvalidTokenError, User.DoesNotExist):
        return None, None


class JWTAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = None
        headers = dict(scope.get("headers") or [])
        auth_header = headers.get(b"authorization", b"").decode()
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer ") :].strip() or None
        if not token:
            subs = scope.get("subprotocols") or []
            if len(subs) >= 2 and subs[0] == "bearer":
                token = subs[1]
        user, session_id = await get_user_from_token(token)
        scope["user"] = user
        scope["session_id"] = session_id
        return await self.app(scope, receive, send)
