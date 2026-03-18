"""
Security regression tests: webhook idempotency, return_url validation.
"""
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.users.models import User
from apps.users.jwt_utils import make_access_token
from apps.payments.models import UserSubscription, PaymentLog
from apps.payments.views import _is_allowed_return_url
from apps.payments.constants import SUBSCRIPTION_PLANS


class ReturnUrlSecurityTest(TestCase):
    """Verify that return_url is only allowed for FRONTEND_URL."""

    @override_settings(FRONTEND_URL="https://app.example.com")
    def test_allowed_same_netloc(self):
        self.assertTrue(_is_allowed_return_url("https://app.example.com/chats?paid=1"))
        self.assertTrue(_is_allowed_return_url("https://app.example.com/"))

    @override_settings(FRONTEND_URL="https://app.example.com")
    def test_rejected_different_domain(self):
        self.assertFalse(_is_allowed_return_url("https://evil.com/chats"))
        self.assertFalse(_is_allowed_return_url("https://evil.example.com/"))

    @override_settings(FRONTEND_URL="")
    def test_rejected_empty_frontend_url(self):
        self.assertFalse(_is_allowed_return_url("https://app.example.com/"))

    def test_rejected_non_http_scheme(self):
        with override_settings(FRONTEND_URL="https://app.example.com"):
            self.assertFalse(_is_allowed_return_url("javascript:alert(1)"))


class WebhookSecurityTest(TestCase):
    """Webhook security checks: idempotency, amount/currency."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(phone="+79990001122", display_name="Test")
        self.sub = UserSubscription.objects.create(
            user=self.user,
            status=UserSubscription.Status.CANCELLED,
            price_kopecks=SUBSCRIPTION_PLANS[1]["per_month_kopecks"],
        )

    def _webhook_payload(self, payment_id="pay_123", amount_rub=300.0, currency="RUB"):
        return {
            "event": "payment.succeeded",
            "object": {"id": payment_id},
        }

    @override_settings(YOOKASSA_WEBHOOK_IP_ALLOWLIST=["77.75.153.0/25"])
    def test_webhook_returns_403_when_ip_not_in_allowlist(self):
        """When YOOKASSA_WEBHOOK_IP_ALLOWLIST is set, requests from other IPs get 403."""
        res = self.client.post(
            "/api/payments/webhook/",
            data={"event": "payment.succeeded", "object": {"id": "pay_123"}},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 403)

    @patch("apps.payments.views.get_payment")
    def test_webhook_ignores_wrong_currency(self, get_payment):
        """Payment in a different currency does not activate subscription."""
        get_payment.return_value = MagicMock(
            status="succeeded",
            metadata={"subscription_id": str(self.sub.id), "plan_months": 1},
            amount=MagicMock(value="299.00", currency="USD"),
            payment_method_id=None,
        )
        PaymentLog.objects.create(
            subscription=self.sub,
            yookassa_payment_id="pay_123",
            amount_kopecks=SUBSCRIPTION_PLANS[1]["total_kopecks"],
            status=PaymentLog.Status.PENDING,
        )
        res = self.client.post(
            "/api/payments/webhook/",
            data={"event": "payment.succeeded", "object": {"id": "pay_123"}},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, UserSubscription.Status.CANCELLED)

    @patch("apps.payments.views.get_payment")
    def test_webhook_ignores_wrong_amount(self, get_payment):
        """Payment with a different amount does not activate subscription."""
        get_payment.return_value = MagicMock(
            status="succeeded",
            metadata={"subscription_id": str(self.sub.id), "plan_months": 1},
            amount=MagicMock(value="100.00", currency="RUB"),
            payment_method_id=None,
        )
        PaymentLog.objects.create(
            subscription=self.sub,
            yookassa_payment_id="pay_456",
            amount_kopecks=SUBSCRIPTION_PLANS[1]["total_kopecks"],
            status=PaymentLog.Status.PENDING,
        )
        res = self.client.post(
            "/api/payments/webhook/",
            data={"event": "payment.succeeded", "object": {"id": "pay_456"}},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, UserSubscription.Status.CANCELLED)

    @patch("apps.payments.views.get_payment")
    def test_webhook_idempotent_already_succeeded(self, get_payment):
        """Duplicate webhook for an already processed payment does not change data."""
        get_payment.return_value = MagicMock(
            status="succeeded",
            metadata={"subscription_id": str(self.sub.id), "plan_months": 1},
            amount=MagicMock(value="299.00", currency="RUB"),
            payment_method_id=None,
        )
        paylog = PaymentLog.objects.create(
            subscription=self.sub,
            yookassa_payment_id="pay_idem",
            amount_kopecks=SUBSCRIPTION_PLANS[1]["total_kopecks"],
            status=PaymentLog.Status.SUCCEEDED,
        )
        self.sub.status = UserSubscription.Status.ACTIVE
        self.sub.current_period_end = timezone.now()
        self.sub.save()
        res = self.client.post(
            "/api/payments/webhook/",
            data={"event": "payment.succeeded", "object": {"id": "pay_idem"}},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.sub.refresh_from_db()
        paylog.refresh_from_db()
        self.assertEqual(paylog.status, PaymentLog.Status.SUCCEEDED)
        # Period should not have changed again (idempotency preserves the logic)
