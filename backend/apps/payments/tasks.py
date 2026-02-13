from datetime import timedelta
from django.utils import timezone
from celery import shared_task
from .models import UserSubscription, PaymentLog
from .constants import SUBSCRIPTION_PERIOD_DAYS
from .yookassa_client import create_recurring_payment


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
                sub.current_period_end = timezone.now() + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
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
