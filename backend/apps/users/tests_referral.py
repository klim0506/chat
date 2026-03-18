from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.payments.constants import REFERRAL_MILESTONES, TRIAL_PERIOD_DAYS
from apps.payments.models import ReferralReward, UserSubscription
from apps.payments.services import award_referral_subscription
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

    def test_referral_registration_grants_referral_trial(self):
        res = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(res.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.inviter.refresh_from_db()

        self.assertEqual(invitee.referred_by_id, self.inviter.id)
        # No milestone reached for 1 referral — no subscription reward
        self.assertEqual(ReferralReward.objects.filter(user=self.inviter).count(), 0)

        sub = UserSubscription.objects.get(user=invitee)
        self.assertEqual(sub.status, UserSubscription.Status.TRIAL)
        self.assertTrue(sub.is_referral_trial)
        self.assertIsNotNone(sub.current_period_end)  # Trial is 5 days
        self.assertGreater(sub.current_period_end, timezone.now())
        self.assertLess(
            (sub.current_period_end - timezone.now()).days,
            TRIAL_PERIOD_DAYS + 1,
        )

    def test_existing_user_login_does_not_reapply_referral(self):
        first = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(first.status_code, 200)

        second = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(second.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.assertEqual(invitee.referred_by_id, self.inviter.id)
        self.assertEqual(self.inviter.referrals.count(), 1)

    def test_self_referral_code_is_ignored(self):
        res = self._verify(self.inviter.phone, self.ref_code)
        self.assertEqual(res.status_code, 200)
        user = User.objects.get(phone=self.inviter.phone)
        self.assertIsNone(user.referred_by_id)


class ReferralMilestoneTest(TestCase):
    """10 invited → 1 month, 40 → 6 months, 80 → 1 year."""

    def test_milestone_10_grants_1_month(self):
        inviter = User.objects.create_user(phone="+79990000200", display_name="Inviter")
        for i in range(10):
            User.objects.create_user(
                phone=f"+799900003{i:02d}",
                display_name=f"Invitee{i}",
                referred_by=inviter,
            )
        award_referral_subscription(inviter, inviter.referrals.first())
        rw = ReferralReward.objects.get(user=inviter, tier=10)
        self.assertEqual(rw.months_granted, REFERRAL_MILESTONES[10])
        sub = UserSubscription.objects.get(user=inviter)
        self.assertTrue(sub.current_period_end is not None)
