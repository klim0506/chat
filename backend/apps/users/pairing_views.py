"""
QR / code-based login pairing.

Logged-in device creates a short-lived pairing token. New device scans QR (or enters code)
and exchanges it for access + refresh tokens.
"""
import secrets
from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User, UserSession
from .serializers import UserSerializer
from .jwt_utils import make_access_token, make_refresh_token
from .views import _create_session, _set_refresh_cookie
from .throttles import PairingExchangeThrottle

PAIRING_TTL = 300  # 5 minutes
PAIRING_KEY_PREFIX = "pairing:"
PAIRING_CODE_PREFIX = "pairing_code:"


def _generate_code() -> str:
    """6-digit code for manual entry."""
    return "".join(secrets.choice("0123456789") for _ in range(6))


class CreatePairingView(APIView):
    """Create pairing token + code for QR login. Authenticated users only."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.is_active:
            return Response({"detail": "Аккаунт деактивирован."}, status=status.HTTP_403_FORBIDDEN)

        token = secrets.token_urlsafe(32)
        code = _generate_code()

        data = {"user_id": str(user.id), "code": code}
        cache.set(f"{PAIRING_KEY_PREFIX}{token}", data, timeout=PAIRING_TTL)
        cache.set(f"{PAIRING_CODE_PREFIX}{code}", {"token": token, "user_id": str(user.id)}, timeout=PAIRING_TTL)

        base_url = getattr(settings, "FRONTEND_URL", "").rstrip("/") or request.build_absolute_uri("/").rstrip("/")
        qr_url = f"{base_url}/auth?pairing={token}"

        return Response({
            "token": token,
            "code": code,
            "qr_url": qr_url,
            "expires_in": PAIRING_TTL,
        })


class ExchangePairingView(APIView):
    """Exchange pairing token or code for access + refresh tokens. Public."""
    permission_classes = [AllowAny]
    throttle_classes = [PairingExchangeThrottle]

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        code = (request.data.get("code") or "").strip().replace(" ", "").replace("-", "")

        if not token and not code:
            return Response({"detail": "token или code обязателен."}, status=status.HTTP_400_BAD_REQUEST)

        user_id = None
        token_key = None
        code_to_delete = None

        if token:
            data = cache.get(f"{PAIRING_KEY_PREFIX}{token}")
            if data:
                user_id = data.get("user_id")
                token_key = token
                code_to_delete = data.get("code")

        if not user_id and code:
            mapping = cache.get(f"{PAIRING_CODE_PREFIX}{code}")
            if mapping:
                token_key = mapping.get("token")
                user_id = mapping.get("user_id")
                code_to_delete = code

        if not user_id:
            return Response({"detail": "Неверный или просроченный код. Создайте новый на другом устройстве."}, status=status.HTTP_400_BAD_REQUEST)

        # Invalidate both keys (one-time use)
        if token_key:
            cache.delete(f"{PAIRING_KEY_PREFIX}{token_key}")
        if code_to_delete:
            cache.delete(f"{PAIRING_CODE_PREFIX}{code_to_delete}")

        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({"detail": "Пользователь не найден."}, status=status.HTTP_404_NOT_FOUND)

        if not user.is_active:
            return Response({"detail": "Аккаунт деактивирован."}, status=status.HTTP_403_FORBIDDEN)

        client = (request.META.get("HTTP_X_CLIENT") or "").strip().lower()
        if client not in ("android", "desktop"):
            client = "web"

        session = _create_session(request, user, client_type=client)
        access = make_access_token(user.id, session.id)
        refresh = make_refresh_token(user.id, session.id, client_type=client)

        response = Response({
            "access": access,
            "refresh": refresh,
            "user": UserSerializer(user, context={"request": request}).data,
        })
        if client == "web":
            _set_refresh_cookie(response, refresh)
        return response
