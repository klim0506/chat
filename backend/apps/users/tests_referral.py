from django.test import TestCase
from rest_framework.test import APIClient
from unittest.mock import patch

from apps.payments.constants import REFERRAL_MILESTONES
from apps.payments.models import ReferralReward, UserSubscription
from apps.payments.services import grant_referral_rewards_on_login
from apps.users.models import User
from apps.users.services import set_otp


class ReferralFlowTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.notify_patcher = patch("apps.users.views.notify_new_login")
        self.notify_patcher.start()
        self.verify_attempts_patcher = patch("apps.users.views.incr_verify_attempts", return_value=1)
        self.verify_attempts_patcher.start()
        self.inviter = User.objects.create_user(
            phone="+79990000001",
            display_name="Inviter",
            username="inviter",
        )
        self.ref_code = self.inviter.referral_code
        self.new_phone = "+79990000002"

    def tearDown(self):
        self.notify_patcher.stop()
        self.verify_attempts_patcher.stop()

    def _verify(self, phone: str, ref: str | None = None, username: str | None = None):
        set_otp(phone, "123456")
        payload = {"phone": phone, "code": "123456"}
        if ref:
            payload["ref"] = ref
        if username:
            payload["username"] = username
        return self.client.post("/api/auth/verify-code/", payload, format="json")

    def test_referral_registration_keeps_invitee_free(self):
        res = self._verify(self.new_phone, self.ref_code, username="invitee")
        self.assertEqual(res.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.inviter.refresh_from_db()

        self.assertEqual(invitee.referred_by_id, self.inviter.id)
        self.assertFalse(UserSubscription.objects.filter(user=invitee).exists())
        self.assertEqual(ReferralReward.objects.filter(user=self.inviter).count(), 0)

    def test_existing_user_login_does_not_reapply_referral(self):
        first = self._verify(self.new_phone, self.ref_code, username="invitee")
        self.assertEqual(first.status_code, 200)

        second = self._verify(self.new_phone, self.ref_code)
        self.assertEqual(second.status_code, 200)

        invitee = User.objects.get(phone=self.new_phone)
        self.assertEqual(invitee.referred_by_id, self.inviter.id)
        self.assertEqual(self.inviter.referrals.count(), 1)
        self.assertFalse(UserSubscription.objects.filter(user=invitee).exists())

    def test_self_referral_code_is_ignored(self):
        res = self._verify(self.inviter.phone, self.ref_code)
        self.assertEqual(res.status_code, 200)
        user = User.objects.get(phone=self.inviter.phone)
        self.assertIsNone(user.referred_by_id)


class ReferralMilestoneTest(TestCase):
    def setUp(self):
        self.notify_patcher = patch("apps.users.views.notify_new_login")
        self.notify_patcher.start()
        self.verify_attempts_patcher = patch("apps.users.views.incr_verify_attempts", return_value=1)
        self.verify_attempts_patcher.start()

    def tearDown(self):
        self.notify_patcher.stop()
        self.verify_attempts_patcher.stop()

    def _login(self, phone: str):
        client = APIClient()
        set_otp(phone, "123456")
        return client.post(
            "/api/auth/verify-code/",
            {"phone": phone, "code": "123456"},
            format="json",
        )

    def test_milestone_reward_is_granted_on_next_login(self):
        inviter = User.objects.create_user(
            phone="+79990000200",
            display_name="Inviter",
            username="reward_inviter",
        )
        for i in range(10):
            User.objects.create_user(
                phone=f"+799900003{i:02d}",
                display_name=f"Invitee{i}",
                username=f"invitee_{i}",
                referred_by=inviter,
            )

        self.assertEqual(ReferralReward.objects.filter(user=inviter).count(), 0)
        self.assertFalse(UserSubscription.objects.filter(user=inviter).exists())

        res = self._login(inviter.phone)
        self.assertEqual(res.status_code, 200)

        reward = ReferralReward.objects.get(user=inviter, tier=10)
        self.assertEqual(reward.months_granted, REFERRAL_MILESTONES[10])
        sub = UserSubscription.objects.get(user=inviter)
        self.assertEqual(sub.status, UserSubscription.Status.ACTIVE)
        self.assertIsNotNone(sub.current_period_end)

    def test_milestone_reward_is_not_regranted_after_claim(self):
        inviter = User.objects.create_user(
            phone="+79990000400",
            display_name="Inviter",
            username="claimed_inviter",
        )
        for i in range(10):
            User.objects.create_user(
                phone=f"+799900005{i:02d}",
                display_name=f"Invitee{i}",
                username=f"claimed_{i}",
                referred_by=inviter,
            )

        self.assertTrue(grant_referral_rewards_on_login(inviter))
        sub = UserSubscription.objects.get(user=inviter)
        first_period_end = sub.current_period_end

        self.assertFalse(grant_referral_rewards_on_login(inviter))

        sub.refresh_from_db()
        self.assertEqual(ReferralReward.objects.filter(user=inviter, tier=10).count(), 1)
        self.assertEqual(sub.current_period_end, first_period_end)
