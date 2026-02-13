"""
Security regression tests: JWT token type, rate limiting.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.users.models import User
from apps.users.jwt_utils import make_access_token, make_refresh_token
from apps.users.views import SendCodeView


class JWTAuthSecurityTest(TestCase):
    """Проверка, что refresh-токен не принимается как access."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+79990001122", display_name="Test")
        self.client = APIClient()

    def test_access_token_allows_api_access(self):
        """Access-токен даёт доступ к /api/auth/me/."""
        token = make_access_token(self.user.pk)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_refresh_token_rejected_as_bearer(self):
        """Refresh-токен в заголовке Authorization должен приводить к 401."""
        refresh = make_refresh_token(self.user.pk)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 401)

    def test_no_auth_returns_401_for_protected(self):
        """Без токена защищённый эндпоинт — 401."""
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 401)


class AuthRateLimitTest(TestCase):
    """Проверка, что throttle подключён к auth-эндпоинтам."""

    def setUp(self):
        self.client = APIClient()
        from django.core.cache import cache
        cache.clear()

    def test_send_code_has_throttle(self):
        """У SendCodeView задан throttle_classes."""
        self.assertTrue(hasattr(SendCodeView, "throttle_classes") and len(SendCodeView.throttle_classes) > 0)

    @override_settings(
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            }
        },
        REST_FRAMEWORK={
            "DEFAULT_AUTHENTICATION_CLASSES": ["apps.users.auth.JWTAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
            "DEFAULT_THROTTLE_RATES": {"auth_send_code": "2/min"},
        },
    )
    @patch("apps.users.views.can_send_sms", return_value=True)
    @patch("apps.users.views.send_telegram_verification", return_value=None)
    @patch("apps.users.views.send_sms", return_value=True)
    def test_send_code_throttled_after_limit(self, mock_sms, mock_tg, mock_can):
        """После превышения лимита send-code возвращает 429."""
        from django.core.cache import cache
        cache.clear()
        for _ in range(3):
            res = self.client.post(
                "/api/auth/send-code/",
                {"phone": "+79990001122"},
                format="json",
            )
        self.assertEqual(res.status_code, 429, f"Ожидался 429 (throttle), получен {res.status_code}")
