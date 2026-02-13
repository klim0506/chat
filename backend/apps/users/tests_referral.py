from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.payments.constants import (
    REFERRAL_TRIAL_PERIOD_DAYS,
    STARS_PER_REFERRAL_INVITEE,
    STARS_PER_REFERRAL_INVITER,
)
from apps.payments.models import StarTransaction, UserSubscription
from apps.payments.services import award_referral_stars
from apps.users.models import User
from apps.users.services import set_otp


class ReferralFlowTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.inviter = User.objects.create_user(phone="+79990000001", display_name="Inviter")
        self.ref_code = self.inviter.referral_code
        self.new_phone = "+79990000002"

    def _verify(self, phone: str, ref: str | None = None):
        set_otp(phone, "123456")
        payload = {"phone": phone, "code": "123456"}
        if ref:
            payload["ref"] = ref
        return self.client.post("/api/auth/verify-code/", payload, format="json")

    def test_referral_registration_awards_stars_and_referral_trial(self):
        res = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(res.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.inviter.refresh_from_db()
        invitee.refresh_from_db()

        self.assertEqual(invitee.referred_by_id, self.inviter.id)
        self.assertEqual(self.inviter.stars, STARS_PER_REFERRAL_INVITER)
        self.assertEqual(invitee.stars, STARS_PER_REFERRAL_INVITEE)

        self.assertTrue(
            StarTransaction.objects.filter(
                user=self.inviter,
                reason=StarTransaction.Reason.REFERRAL_INVITER,
                related_user=invitee,
                amount=STARS_PER_REFERRAL_INVITER,
            ).exists()
        )
        self.assertTrue(
            StarTransaction.objects.filter(
                user=invitee,
                reason=StarTransaction.Reason.REFERRAL_INVITEE,
                related_user=self.inviter,
                amount=STARS_PER_REFERRAL_INVITEE,
            ).exists()
        )

        sub = UserSubscription.objects.get(user=invitee)
        self.assertEqual(sub.status, UserSubscription.Status.TRIAL)
        self.assertTrue(sub.is_referral_trial)
        self.assertIsNotNone(sub.current_period_end)
        expected_min_end = timezone.now() + timedelta(days=REFERRAL_TRIAL_PERIOD_DAYS - 1)
        self.assertGreater(sub.current_period_end, expected_min_end)

    def test_existing_user_login_does_not_reapply_referral_rewards(self):
        first = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(first.status_code, 200)

        second = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(second.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.inviter.refresh_from_db()
        invitee.refresh_from_db()

        self.assertEqual(self.inviter.stars, STARS_PER_REFERRAL_INVITER)
        self.assertEqual(invitee.stars, STARS_PER_REFERRAL_INVITEE)
        self.assertEqual(
            StarTransaction.objects.filter(
                user=self.inviter,
                reason=StarTransaction.Reason.REFERRAL_INVITER,
                related_user=invitee,
            ).count(),
            1,
        )
        self.assertEqual(
            StarTransaction.objects.filter(
                user=invitee,
                reason=StarTransaction.Reason.REFERRAL_INVITEE,
                related_user=self.inviter,
            ).count(),
            1,
        )

    def test_self_referral_code_is_ignored(self):
        res = self._verify(self.inviter.phone, self.ref_code)
        self.assertEqual(res.status_code, 200)
        self.inviter.refresh_from_db()

        self.assertIsNone(self.inviter.referred_by_id)
        self.assertEqual(
            StarTransaction.objects.filter(
                user=self.inviter,
                reason__in=[
                    StarTransaction.Reason.REFERRAL_INVITER,
                    StarTransaction.Reason.REFERRAL_INVITEE,
                ],
            ).count(),
            0,
        )


class ReferralServiceIdempotencyTest(TestCase):
    def setUp(self):
        self.inviter = User.objects.create_user(phone="+79990000010", display_name="A")
        self.invitee = User.objects.create_user(phone="+79990000011", display_name="B")

    def test_award_referral_stars_idempotent(self):
        first = award_referral_stars(self.inviter, self.invitee)
        second = award_referral_stars(self.inviter, self.invitee)
        self.assertTrue(first)
        self.assertFalse(second)

        self.inviter.refresh_from_db()
        self.invitee.refresh_from_db()

        self.assertEqual(self.inviter.stars, STARS_PER_REFERRAL_INVITER)
        self.assertEqual(self.invitee.stars, STARS_PER_REFERRAL_INVITEE)
        self.assertEqual(
            StarTransaction.objects.filter(
                user=self.inviter,
                reason=StarTransaction.Reason.REFERRAL_INVITER,
                related_user=self.invitee,
            ).count(),
            1,
        )
        self.assertEqual(
            StarTransaction.objects.filter(
                user=self.invitee,
                reason=StarTransaction.Reason.REFERRAL_INVITEE,
                related_user=self.inviter,
            ).count(),
            1,
        )
