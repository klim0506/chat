from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.common.test_helpers import auth_client, create_user
from apps.payments.constants import (
    INTRO_OFFER_CODE,
    INTRO_OFFER_DAYS,
    INTRO_OFFER_PRICE_KOPECKS,
    INTRO_OFFER_RENEW_PRICE_KOPECKS,
)
from apps.payments.models import PaymentLog, UserSubscription
from apps.payments.services import create_subscription_for_user


@override_settings(
    FRONTEND_URL="http://testserver",
    YOOKASSA_WEBHOOK_IP_ALLOWLIST=[],
)
class IntroOfferPaymentTest(TestCase):
    def setUp(self):
        self.user = create_user(username="intro_offer_user")
        self.client = auth_client(self.user)

    def test_subscription_status_exposes_intro_offer_for_free_user(self):
        res = self.client.get("/api/payments/subscription/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["intro_offer_available"])
        self.assertEqual(res.data["intro_offer"]["offer_code"], INTRO_OFFER_CODE)
        self.assertEqual(res.data["intro_offer"]["price_rub"], 11)
        self.assertEqual(res.data["intro_offer"]["duration_days"], INTRO_OFFER_DAYS)
        self.assertEqual(res.data["intro_offer"]["renew_price_rub"], 299)

    def test_intro_offer_is_hidden_for_active_subscription(self):
        create_subscription_for_user(self.user)
        res = self.client.get("/api/payments/subscription/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["intro_offer_available"])

    def test_intro_offer_cannot_be_reused(self):
        UserSubscription.objects.create(
            user=self.user,
            status=UserSubscription.Status.CANCELLED,
            price_kopecks=INTRO_OFFER_RENEW_PRICE_KOPECKS,
            intro_offer_used_at=timezone.now(),
        )
        res = self.client.post(
            "/api/payments/subscribe/",
            {"offer_code": INTRO_OFFER_CODE, "return_url": "http://testserver/settings?paid=1"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Пробная неделя уже была использована", res.data["detail"])

    @patch("apps.payments.views.get_payment")
    @patch("apps.payments.views.create_payment")
    def test_intro_offer_payment_activates_trial_and_sets_monthly_recurring_price(self, mock_create_payment, mock_get_payment):
        payment_id = "pay_intro_1"
        mock_create_payment.return_value = SimpleNamespace(
            id=payment_id,
            confirmation=SimpleNamespace(confirmation_url="https://pay.example/confirm"),
        )

        res = self.client.post(
            "/api/payments/subscribe/",
            {"offer_code": INTRO_OFFER_CODE, "return_url": "http://testserver/settings?paid=1"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["offer_code"], INTRO_OFFER_CODE)
        self.assertEqual(res.data["amount"], INTRO_OFFER_PRICE_KOPECKS / 100)

        sub = UserSubscription.objects.get(user=self.user)
        paylog = PaymentLog.objects.get(subscription=sub, yookassa_payment_id=payment_id)
        self.assertEqual(paylog.amount_kopecks, INTRO_OFFER_PRICE_KOPECKS)
        self.assertEqual(paylog.status, PaymentLog.Status.PENDING)

        mock_get_payment.return_value = SimpleNamespace(
            status="succeeded",
            metadata={
                "subscription_id": str(sub.id),
                "offer_code": INTRO_OFFER_CODE,
            },
            amount=SimpleNamespace(value="11.00", currency="RUB"),
            payment_method=SimpleNamespace(id="pm_saved_card"),
        )

        webhook_res = self.client.post(
            "/api/payments/webhook/",
            {"event": "payment.succeeded", "object": {"id": payment_id}},
            format="json",
        )
        self.assertEqual(webhook_res.status_code, 200)

        sub.refresh_from_db()
        paylog.refresh_from_db()
        self.assertEqual(sub.status, UserSubscription.Status.TRIAL)
        self.assertEqual(sub.price_kopecks, INTRO_OFFER_RENEW_PRICE_KOPECKS)
        self.assertEqual(sub.yookassa_payment_method_id, "pm_saved_card")
        self.assertIsNotNone(sub.intro_offer_used_at)
        self.assertIsNotNone(sub.current_period_end)
        remaining = sub.current_period_end - timezone.now()
        self.assertGreater(remaining.total_seconds(), 6 * 24 * 60 * 60)
        self.assertLess(remaining.total_seconds(), 8 * 24 * 60 * 60)
        self.assertEqual(paylog.status, PaymentLog.Status.SUCCEEDED)
