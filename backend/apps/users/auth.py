import time
from rest_framework import authentication, exceptions
import jwt
from django.conf import settings
from django.contrib.auth import get_user_model

User = get_user_model()

# Throttle last_active updates to once per 5 minutes per session
_last_active_cache: dict[str, float] = {}
_LAST_ACTIVE_INTERVAL = 300  # seconds


def _check_session_active(payload):
    """Check that the session referenced by JWT payload is still active.
    Returns None for legacy tokens (no sid) — they are allowed through.
    Raises AuthenticationFailed if the session has been revoked."""
    sid = payload.get("sid")
    if not sid:
        return  # Legacy token without session tracking — allow through
    from apps.users.models import UserSession
    if not UserSession.objects.filter(id=sid, is_active=True).exists():
        raise exceptions.AuthenticationFailed("Session revoked")
    # Throttled update of last_active
    now = time.time()
    last = _last_active_cache.get(sid, 0)
    if now - last > _LAST_ACTIVE_INTERVAL:
        _last_active_cache[sid] = now
        from django.utils import timezone as tz
        UserSession.objects.filter(id=sid, is_active=True).update(last_active=tz.now())


class JWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        auth = request.META.get("HTTP_AUTHORIZATION")
        if not auth or not auth.startswith(self.keyword + " "):
            return None
        token = auth[len(self.keyword) + 1 :].strip()
        if not token:
            return None
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
            if payload.get("type") not in (None, "access"):
                raise exceptions.AuthenticationFailed("Invalid token type")
            user_id = payload.get("user_id")
            if not user_id:
                raise exceptions.AuthenticationFailed("Invalid token")
            # Check session is still active (skip for legacy tokens without sid)
            _check_session_active(payload)
            user = User.objects.get(pk=user_id)
            if not user.is_active:
                raise exceptions.AuthenticationFailed("User inactive")
            # Attach session_id to request for downstream use
            request.session_id = payload.get("sid")
            return (user, token)
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed("Token expired")
        except jwt.InvalidTokenError:
            raise exceptions.AuthenticationFailed("Invalid token")
        except User.DoesNotExist:
            raise exceptions.AuthenticationFailed("User not found")

    def authenticate_header(self, request):
        return self.keyword
