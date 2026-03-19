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
    @patch("apps.users.views.send_telegram_verification", return_value=(None, None))
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



class SendCodePerMinuteLimitTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    @override_settings(
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            }
        },
        REST_FRAMEWORK={
            "DEFAULT_AUTHENTICATION_CLASSES": ["apps.users.auth.JWTAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
            "DEFAULT_THROTTLE_RATES": {"auth_send_code": "100/min"},
        },
    )
    @patch("apps.users.services._redis_available", return_value=False)
    @patch("apps.users.views.send_telegram_verification", return_value=(None, None))
    @patch("apps.users.views.send_sms", return_value=True)
    def test_soft_limit_blocks_only_after_two_requests(self, mock_sms, mock_tg, mock_no_redis):
        from apps.users import services

        services._mem_store.clear()
        phone = "+79990009991"

        res1 = self.client.post("/api/auth/send-code/", {"phone": phone}, format="json")
        res2 = self.client.post("/api/auth/send-code/", {"phone": phone}, format="json")
        res3 = self.client.post("/api/auth/send-code/", {"phone": phone}, format="json")

        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res3.status_code, 429)
        expected_detail = (
            "\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u043a\u043e\u0434 "
            "\u043c\u043e\u0436\u043d\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0438\u0442\u044c "
            "\u0447\u0435\u0440\u0435\u0437 \u043c\u0438\u043d\u0443\u0442\u0443."
        )
        self.assertEqual(res3.data.get("detail"), expected_detail)


class SendCodeDeliveryRoutingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            phone="+79990005555",
            display_name="Existing user",
            username="existing_user",
        )

    @patch("apps.users.views.can_send_sms", return_value=True)
    @patch("apps.users.views.send_sms", return_value=True)
    @patch("apps.users.views.send_telegram_verification", return_value=({"request_id": "tg-1"}, None))
    @patch("apps.users.views.send_pingy_verification_message", return_value=True)
    @patch("apps.users.views.generate_code", return_value="654321")
    def test_active_session_prefers_pingy_over_telegram(
        self,
        mock_generate,
        mock_pingy,
        mock_tg,
        mock_sms,
        mock_can,
    ):
        from apps.users.models import UserSession

        UserSession.objects.create(user=self.user, is_active=True, device_label="Chrome")

        res = self.client.post(
            "/api/auth/send-code/",
            {"phone": self.user.phone},
            format="json",
        )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data.get("method"), "pingy")
        mock_pingy.assert_called_once_with(self.user, "654321")
        mock_tg.assert_not_called()
        mock_sms.assert_not_called()

    @patch("apps.users.views.can_send_sms", return_value=True)
    @patch("apps.users.views.send_sms", return_value=True)
    @patch("apps.users.views.send_telegram_verification", return_value=({"request_id": "tg-2"}, None))
    @patch("apps.users.views.send_pingy_verification_message", return_value=True)
    @patch("apps.users.views.generate_code", return_value="112233")
    @patch("apps.users.views.get_otp", return_value="112233")
    def test_explicit_telegram_request_reuses_existing_code(
        self,
        mock_get_otp,
        mock_generate,
        mock_pingy,
        mock_tg,
        mock_sms,
        mock_can,
    ):
        from apps.users.models import UserSession

        UserSession.objects.create(user=self.user, is_active=True, device_label="Desktop")

        first = self.client.post(
            "/api/auth/send-code/",
            {"phone": self.user.phone},
            format="json",
        )
        second = self.client.post(
            "/api/auth/send-code/",
            {"phone": self.user.phone, "method": "telegram", "reuse_existing": True},
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data.get("method"), "pingy")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data.get("method"), "telegram")
        mock_pingy.assert_called_once_with(self.user, "112233")
        mock_tg.assert_called_once_with(self.user.phone, "112233")
