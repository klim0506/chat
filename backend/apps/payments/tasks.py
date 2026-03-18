import logging
from datetime import timedelta
from django.utils import timezone
from celery import shared_task
from dateutil.relativedelta import relativedelta

from .models import UserSubscription, PaymentLog, StarTransaction
from .yookassa_client import create_recurring_payment

logger = logging.getLogger(__name__)


@shared_task
def charge_recurring_subscriptions():
    """Списание подписки для пользователей с истёкшим периодом."""
    now = timezone.now()
    subs = (
        UserSubscription.objects.filter(
            status__in=[UserSubscription.Status.ACTIVE, UserSubscription.Status.TRIAL],
            current_period_end__lt=now,
        )
        .exclude(yookassa_payment_method_id="")
        .exclude(price_kopecks=0)
    )
    for sub in subs:
        try:
            amount_rubles = sub.price_kopecks / 100.0
            payment = create_recurring_payment(
                amount_rubles=amount_rubles,
                payment_method_id=sub.yookassa_payment_method_id,
                description=f"Продление подписки ({sub.user.phone})",
                metadata={"subscription_id": str(sub.id)},
            )
            PaymentLog.objects.create(
                subscription=sub,
                yookassa_payment_id=payment.id,
                amount_kopecks=sub.price_kopecks,
                status=PaymentLog.Status.PENDING,
                raw_response={"id": payment.id},
            )
            if payment.status == "succeeded":
                sub.status = UserSubscription.Status.ACTIVE
                sub.current_period_start = timezone.now()
                sub.current_period_end = timezone.now() + relativedelta(months=1)
                sub.save()
                PaymentLog.objects.filter(yookassa_payment_id=payment.id).update(
                    status=PaymentLog.Status.SUCCEEDED,
                )
            elif getattr(payment, "status", None) in ("canceled", "cancelled"):
                sub.status = UserSubscription.Status.PAST_DUE
                sub.save()
                PaymentLog.objects.filter(yookassa_payment_id=payment.id).update(
                    status=PaymentLog.Status.CANCELLED,
                )
        except Exception:
            sub.status = UserSubscription.Status.PAST_DUE
            sub.save()


@shared_task
def purge_old_idempotency_records():
    """
    Purge old idempotency-related records no longer needed for support:
    - PaymentLog with terminal status (succeeded, cancelled, refunded), older than 30 days
    - StarTransaction with referral reasons, older than 30 days
    Keeps pending PaymentLog and non-referral StarTransactions regardless of age.
    """
    cutoff = timezone.now() - timedelta(days=30)
    terminal_statuses = [
        PaymentLog.Status.SUCCEEDED,
        PaymentLog.Status.CANCELLED,
        PaymentLog.Status.REFUNDED,
    ]

    pl_deleted, _ = PaymentLog.objects.filter(
        status__in=terminal_statuses,
        created_at__lt=cutoff,
    ).delete()
    st_deleted, _ = StarTransaction.objects.filter(
        reason__in=[
            StarTransaction.Reason.REFERRAL_INVITER,
            StarTransaction.Reason.REFERRAL_INVITEE,
        ],
        created_at__lt=cutoff,
    ).delete()

    if pl_deleted or st_deleted:
        logger.info(
            "purge_old_idempotency_records: deleted %d PaymentLog, %d StarTransaction",
            pl_deleted,
            st_deleted,
        )
