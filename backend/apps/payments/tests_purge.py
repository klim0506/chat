"""Tests for purge_old_idempotency_records Celery task."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.users.models import User
from apps.payments.models import UserSubscription, PaymentLog, StarTransaction
from apps.payments.tasks import purge_old_idempotency_records
from apps.common.test_helpers import create_chat


class PurgeOldIdempotencyRecordsTest(TestCase):
    def setUp(self):
        self.user1 = User.objects.create_user(phone="+79991111111", display_name="User1")
        self.user2 = User.objects.create_user(phone="+79992222222", display_name="User2")
        self.sub1 = UserSubscription.objects.create(
            user=self.user1,
            status=UserSubscription.Status.ACTIVE,
            price_kopecks=30000,
        )
        self.sub2 = UserSubscription.objects.create(
            user=self.user2,
            status=UserSubscription.Status.ACTIVE,
            price_kopecks=30000,
        )
        self.cutoff = timezone.now() - timedelta(days=30)
        self.old_date = timezone.now() - timedelta(days=31)

    def test_deletes_old_terminal_payment_logs(self):
        pl_old = PaymentLog.objects.create(
            subscription=self.sub1,
            yookassa_payment_id="pay-old-terminal",
            amount_kopecks=30000,
            status=PaymentLog.Status.SUCCEEDED,
        )
        PaymentLog.objects.filter(pk=pl_old.pk).update(created_at=self.old_date)
        pl_old.refresh_from_db()
        self.assertLess(pl_old.created_at, self.cutoff)

        purge_old_idempotency_records()
        self.assertFalse(PaymentLog.objects.filter(pk=pl_old.pk).exists())

    def test_preserves_recent_terminal_payment_logs(self):
        pl_recent = PaymentLog.objects.create(
            subscription=self.sub1,
            yookassa_payment_id="pay-recent-terminal",
            amount_kopecks=30000,
            status=PaymentLog.Status.SUCCEEDED,
        )
        purge_old_idempotency_records()
        self.assertTrue(PaymentLog.objects.filter(pk=pl_recent.pk).exists())

    def test_preserves_old_pending_payment_logs(self):
        pl_old_pending = PaymentLog.objects.create(
            subscription=self.sub1,
            yookassa_payment_id="pay-old-pending",
            amount_kopecks=30000,
            status=PaymentLog.Status.PENDING,
        )
        PaymentLog.objects.filter(pk=pl_old_pending.pk).update(created_at=self.old_date)

        purge_old_idempotency_records()
        self.assertTrue(PaymentLog.objects.filter(pk=pl_old_pending.pk).exists())

    def test_deletes_old_referral_star_transactions(self):
        st_old = StarTransaction.objects.create(
            user=self.user1,
            amount=10,
            reason=StarTransaction.Reason.REFERRAL_INVITER,
            description="Invited user2",
            related_user=self.user2,
        )
        StarTransaction.objects.filter(pk=st_old.pk).update(created_at=self.old_date)

        purge_old_idempotency_records()
        self.assertFalse(StarTransaction.objects.filter(pk=st_old.pk).exists())

    def test_preserves_recent_referral_star_transactions(self):
        st_recent = StarTransaction.objects.create(
            user=self.user1,
            amount=10,
            reason=StarTransaction.Reason.REFERRAL_INVITEE,
            description="Registered via link",
            related_user=self.user2,
        )
        purge_old_idempotency_records()
        self.assertTrue(StarTransaction.objects.filter(pk=st_recent.pk).exists())

    def test_preserves_old_non_referral_star_transactions(self):
        chat = create_chat(owner=self.user1, title="Test Chat")
        st_old = StarTransaction.objects.create(
            user=self.user1,
            amount=-50,
            reason=StarTransaction.Reason.CHAT_EXPANSION,
            description="Expanded chat",
            related_chat=chat,
        )
        StarTransaction.objects.filter(pk=st_old.pk).update(created_at=self.old_date)

        purge_old_idempotency_records()
        self.assertTrue(StarTransaction.objects.filter(pk=st_old.pk).exists())
