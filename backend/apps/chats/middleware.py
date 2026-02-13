import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from channels.db import database_sync_to_async

User = get_user_model()


@database_sync_to_async
def get_user_from_token(token):
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("type") not in (None, "access"):
            return None
        user_id = payload.get("user_id")
        if not user_id:
            return None
        return User.objects.get(pk=user_id)
    except (jwt.InvalidTokenError, User.DoesNotExist):
        return None


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
        scope["user"] = await get_user_from_token(token)
        return await self.app(scope, receive, send)
