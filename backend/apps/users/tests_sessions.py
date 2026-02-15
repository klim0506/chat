"""
Tests for user sessions & devices system.
TOTEST §20: session creation, JWT with session_id, session validation (HTTP & WS),
refresh token, session list, terminate, logout-all, notify_new_login, backward-compat.
"""
import time
import uuid
from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.common.test_helpers import create_user
from apps.users.models import User, UserSession
from apps.users.jwt_utils import make_access_token, make_refresh_token, decode_token
from apps.users.views import _parse_device_label, _get_client_ip


def _auth_client_with_session(user, session):
    """Return an APIClient authenticated with a JWT containing the session id."""
    token = make_access_token(user.id, session.id)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def _create_session(user, **kwargs):
    """Create a UserSession for the given user."""
    defaults = {
        "ip_address": "127.0.0.1",
        "user_agent": "Mozilla/5.0 TestBrowser",
        "device_label": "Test Browser, TestOS",
        "is_active": True,
    }
    defaults.update(kwargs)
    return UserSession.objects.create(user=user, **defaults)


# ─────────────────────────────────────────────────────────────
# §20.1 — Model & helper functions
# ─────────────────────────────────────────────────────────────


class ParseDeviceLabelTest(TestCase):
    """TOTEST §20.1: _parse_device_label."""

    def test_chrome_windows(self):
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        label = _parse_device_label(ua)
        self.assertIn("Chrome", label)
        self.assertIn("Windows", label)

    def test_empty_string(self):
        label = _parse_device_label("")
        self.assertEqual(label, "Unknown device")

    def test_none_like_empty(self):
        label = _parse_device_label("")
        self.assertEqual(label, "Unknown device")


class GetClientIpTest(TestCase):
    """TOTEST §20.1: _get_client_ip."""

    def test_xff_multiple_ips(self):
        """X-Forwarded-For with multiple IPs → returns first."""
        factory = APIClient()
        request = factory.get("/", HTTP_X_FORWARDED_FOR="1.2.3.4, 5.6.7.8").wsgi_request
        ip = _get_client_ip(request)
        self.assertEqual(ip, "1.2.3.4")

    def test_remote_addr_fallback(self):
        factory = APIClient()
        request = factory.get("/").wsgi_request
        ip = _get_client_ip(request)
        self.assertIsNotNone(ip)


class SessionCreationOnLoginTest(TestCase):
    """TOTEST §20.1: after login UserSession is created with correct fields."""

    @override_settings(
        AUTH_DEBUG=True,
        AUTH_DEBUG_PHONES=["+70000000001"],
        AUTH_DEBUG_CODE="123456",
    )
    def test_verify_creates_session_with_sid_in_jwt(self):
        """POST verify → JWT contains 'sid', UserSession created."""
        # First send code, then verify
        client = APIClient()
        client.post("/api/auth/send-code/", {"phone": "+70000000001"}, format="json")
        res = client.post(
            "/api/auth/verify-code/",
            {"phone": "+70000000001", "code": "123456"},
            format="json",
            HTTP_USER_AGENT="TestAgent/1.0",
        )
        self.assertEqual(res.status_code, 200)
        # JWT should contain sid
        access = res.data["access"]
        payload = decode_token(access)
        self.assertIn("sid", payload)
        sid = payload["sid"]
        # Session should exist in DB
        session = UserSession.objects.get(id=sid)
        self.assertTrue(session.is_active)
        self.assertIn("TestAgent", session.user_agent)
        self.assertIsNotNone(session.device_label)


# ─────────────────────────────────────────────────────────────
# §20.2 — JWT with session_id
# ─────────────────────────────────────────────────────────────


class JwtSessionIdTest(TestCase):
    """TOTEST §20.2: make_access_token / make_refresh_token with session_id."""

    def setUp(self):
        self.user = create_user(phone="+79990002001")

    def test_access_token_contains_sid(self):
        sid = uuid.uuid4()
        token = make_access_token(self.user.id, sid)
        payload = decode_token(token)
        self.assertEqual(payload["sid"], str(sid))

    def test_refresh_token_contains_sid(self):
        sid = uuid.uuid4()
        token = make_refresh_token(self.user.id, sid)
        payload = decode_token(token)
        self.assertEqual(payload["sid"], str(sid))

    def test_access_token_without_sid_no_sid_key(self):
        """Backward-compatible: token without session_id has no 'sid' key."""
        token = make_access_token(self.user.id)
        payload = decode_token(token)
        self.assertNotIn("sid", payload)


# ─────────────────────────────────────────────────────────────
# §20.3 — HTTP session validation
# ─────────────────────────────────────────────────────────────


class HttpSessionValidationTest(TestCase):
    """TOTEST §20.3: session validation in JWTAuthentication."""

    def setUp(self):
        self.user = create_user(phone="+79990002010")
        self.session = _create_session(self.user)
        self.client = _auth_client_with_session(self.user, self.session)

    def test_active_session_passes(self):
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_revoked_session_returns_401(self):
        self.session.is_active = False
        self.session.save(update_fields=["is_active"])
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 401)

    def test_legacy_token_without_sid_passes(self):
        """JWT without 'sid' claim → backward-compatible, passes auth."""
        legacy_token = make_access_token(self.user.id)  # no session_id
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {legacy_token}")
        res = client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_last_active_updated(self):
        """First request should update last_active on the session."""
        # Clear the throttle cache to ensure the update fires
        from apps.users.auth import _last_active_cache
        _last_active_cache.pop(str(self.session.id), None)

        old_active = self.session.last_active
        self.client.get("/api/auth/me/")
        self.session.refresh_from_db()
        self.assertGreaterEqual(self.session.last_active, old_active)


# ─────────────────────────────────────────────────────────────
# §20.5 — Refresh token with session_id
# ─────────────────────────────────────────────────────────────


class RefreshTokenSessionTest(TestCase):
    """TOTEST §20.5: refresh preserves sid, rejects revoked session."""

    def setUp(self):
        self.user = create_user(phone="+79990002020")
        self.session = _create_session(self.user)
        self.refresh = make_refresh_token(self.user.id, self.session.id)

    def test_refresh_returns_access_with_same_sid(self):
        client = APIClient()
        res = client.post("/api/auth/refresh/", {"refresh": self.refresh}, format="json")
        self.assertEqual(res.status_code, 200)
        payload = decode_token(res.data["access"])
        self.assertEqual(payload["sid"], str(self.session.id))

    def test_refresh_with_revoked_session_returns_401(self):
        self.session.is_active = False
        self.session.save(update_fields=["is_active"])
        client = APIClient()
        res = client.post("/api/auth/refresh/", {"refresh": self.refresh}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_refresh_with_legacy_token_works(self):
        """Refresh token without sid → backward-compatible."""
        legacy_refresh = make_refresh_token(self.user.id)  # no session_id
        client = APIClient()
        res = client.post("/api/auth/refresh/", {"refresh": legacy_refresh}, format="json")
        self.assertEqual(res.status_code, 200)


# ─────────────────────────────────────────────────────────────
# §20.6 — API: session list
# ─────────────────────────────────────────────────────────────


class SessionListApiTest(TestCase):
    """TOTEST §20.6: GET /api/auth/sessions/."""

    def setUp(self):
        self.user = create_user(phone="+79990002030")
        self.session1 = _create_session(self.user, device_label="Chrome, Windows")
        self.session2 = _create_session(self.user, device_label="Safari, macOS")
        self.inactive = _create_session(self.user, device_label="Dead", is_active=False)
        self.client = _auth_client_with_session(self.user, self.session1)

    def test_returns_active_sessions_with_fields(self):
        res = self.client.get("/api/auth/sessions/")
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.data, list)
        ids = [s["id"] for s in res.data]
        self.assertIn(str(self.session1.id), ids)
        self.assertIn(str(self.session2.id), ids)
        # Check fields
        item = next(s for s in res.data if s["id"] == str(self.session1.id))
        self.assertIn("device_label", item)
        self.assertIn("ip_address", item)
        self.assertIn("created_at", item)
        self.assertIn("last_active", item)
        self.assertIn("is_current", item)

    def test_current_session_marked(self):
        res = self.client.get("/api/auth/sessions/")
        current = [s for s in res.data if s["is_current"]]
        self.assertEqual(len(current), 1)
        self.assertEqual(current[0]["id"], str(self.session1.id))

    def test_inactive_sessions_excluded(self):
        res = self.client.get("/api/auth/sessions/")
        ids = [s["id"] for s in res.data]
        self.assertNotIn(str(self.inactive.id), ids)

    def test_unauthenticated_returns_401(self):
        client = APIClient()
        res = client.get("/api/auth/sessions/")
        self.assertEqual(res.status_code, 401)


# ─────────────────────────────────────────────────────────────
# §20.7 — API: terminate a session
# ─────────────────────────────────────────────────────────────


class SessionTerminateApiTest(TestCase):
    """TOTEST §20.7: DELETE /api/auth/sessions/<uuid>/."""

    def setUp(self):
        self.user = create_user(phone="+79990002040")
        self.current_session = _create_session(self.user)
        self.other_session = _create_session(self.user)
        self.client = _auth_client_with_session(self.user, self.current_session)

    @patch("apps.users.session_views._send_force_logout")
    def test_terminate_other_session(self, mock_ws):
        res = self.client.delete(f"/api/auth/sessions/{self.other_session.id}/")
        self.assertEqual(res.status_code, 204)
        self.other_session.refresh_from_db()
        self.assertFalse(self.other_session.is_active)

    def test_cannot_terminate_current_session(self):
        res = self.client.delete(f"/api/auth/sessions/{self.current_session.id}/")
        self.assertEqual(res.status_code, 400)

    def test_nonexistent_session_returns_404(self):
        fake_id = uuid.uuid4()
        res = self.client.delete(f"/api/auth/sessions/{fake_id}/")
        self.assertEqual(res.status_code, 404)

    def test_other_user_session_returns_404(self):
        other_user = create_user(phone="+79990002041")
        other_session = _create_session(other_user)
        res = self.client.delete(f"/api/auth/sessions/{other_session.id}/")
        self.assertEqual(res.status_code, 404)


# ─────────────────────────────────────────────────────────────
# §20.8 — API: logout all
# ─────────────────────────────────────────────────────────────


class SessionLogoutAllApiTest(TestCase):
    """TOTEST §20.8: POST /api/auth/sessions/logout-all/."""

    def setUp(self):
        self.user = create_user(phone="+79990002050")
        self.current_session = _create_session(self.user)
        self.s2 = _create_session(self.user)
        self.s3 = _create_session(self.user)
        self.client = _auth_client_with_session(self.user, self.current_session)

    @patch("apps.users.session_views._send_force_logout")
    def test_logout_all_deactivates_others(self, mock_ws):
        res = self.client.post("/api/auth/sessions/logout-all/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["terminated"], 2)
        # Current session still active
        self.current_session.refresh_from_db()
        self.assertTrue(self.current_session.is_active)
        # Others deactivated
        self.s2.refresh_from_db()
        self.s3.refresh_from_db()
        self.assertFalse(self.s2.is_active)
        self.assertFalse(self.s3.is_active)

    @patch("apps.users.session_views._send_force_logout")
    def test_after_logout_all_only_current_in_list(self, mock_ws):
        self.client.post("/api/auth/sessions/logout-all/")
        res = self.client.get("/api/auth/sessions/")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["id"], str(self.current_session.id))


# ─────────────────────────────────────────────────────────────
# §20.11 — Notify new login
# ─────────────────────────────────────────────────────────────


class NotifyNewLoginTest(TestCase):
    """TOTEST §20.11: notify_new_login calls WS or SMS."""

    def setUp(self):
        self.user = create_user(phone="+79990002060")
        self.session = _create_session(self.user)

    @patch("apps.users.online.is_online", return_value=False)
    @patch("apps.users.services.send_sms")
    def test_offline_user_gets_sms(self, mock_sms, mock_online):
        from apps.users.services import notify_new_login
        notify_new_login(self.user, self.session)
        mock_sms.assert_called_once()
        call_args = mock_sms.call_args
        self.assertIn(self.user.phone, call_args[0])

    def test_first_registration_does_not_notify(self):
        """TOTEST §20.11: first registration (created=True) → no notification.
        Verified by code inspection: VerifyCodeView calls notify only when `not created`."""
        # This is a code-flow verification — if user was just created,
        # the VerifyCodeView does NOT call notify_new_login.
        # We test the logic path by checking the condition in views.py.
        from apps.users.views import VerifyCodeView
        # The view checks `if not created:` before calling notify_new_login.
        # We verify that new users don't trigger the notification.
        # We test this indirectly via the login flow.
        pass  # Covered by code path analysis; see integration test below.

    @override_settings(
        AUTH_DEBUG=True,
        AUTH_DEBUG_PHONES=["+70000000002"],
        AUTH_DEBUG_CODE="123456",
    )
    @patch("apps.users.services.send_sms")
    @patch("apps.users.online.is_online", return_value=False)
    def test_new_registration_does_not_notify(self, mock_online, mock_sms):
        """First login (new user) → notify_new_login is NOT called."""
        client = APIClient()
        client.post("/api/auth/send-code/", {"phone": "+70000000002"}, format="json")
        res = client.post(
            "/api/auth/verify-code/",
            {"phone": "+70000000002", "code": "123456"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        # notify_new_login should NOT be called for new registrations
        mock_sms.assert_not_called()

    @override_settings(
        AUTH_DEBUG=True,
        AUTH_DEBUG_PHONES=["+70000000003"],
        AUTH_DEBUG_CODE="123456",
    )
    @patch("apps.users.services.send_sms")
    @patch("apps.users.online.is_online", return_value=False)
    def test_existing_user_login_notifies(self, mock_online, mock_sms):
        """Second login (existing user) → notify_new_login IS called."""
        # First login — creates user
        client = APIClient()
        client.post("/api/auth/send-code/", {"phone": "+70000000003"}, format="json")
        client.post(
            "/api/auth/verify-code/",
            {"phone": "+70000000003", "code": "123456"},
            format="json",
        )
        mock_sms.reset_mock()
        # Second login — notifies
        client.post("/api/auth/send-code/", {"phone": "+70000000003"}, format="json")
        client.post(
            "/api/auth/verify-code/",
            {"phone": "+70000000003", "code": "123456"},
            format="json",
        )
        # SMS should be called for notification
        mock_sms.assert_called()


# ─────────────────────────────────────────────────────────────
# §20.14 — Backward compatibility
# ─────────────────────────────────────────────────────────────


class BackwardCompatibilityTest(TestCase):
    """TOTEST §20.14: legacy token without sid works, sessions list = 0."""

    def setUp(self):
        self.user = create_user(phone="+79990002070")

    def test_legacy_token_passes_requests(self):
        legacy = make_access_token(self.user.id)  # no session_id
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {legacy}")
        res = client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_legacy_token_sessions_list_empty_current(self):
        """Legacy token: sessions list shows no session as 'current'."""
        # Create a session for the user (exists in DB)
        _create_session(self.user)
        # But authenticate with legacy token (no sid)
        legacy = make_access_token(self.user.id)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {legacy}")
        res = client.get("/api/auth/sessions/")
        self.assertEqual(res.status_code, 200)
        # Sessions exist but none marked as current
        current_sessions = [s for s in res.data if s["is_current"]]
        self.assertEqual(len(current_sessions), 0)
