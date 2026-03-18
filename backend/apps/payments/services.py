"""
Subscription and referral services.
"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from dateutil.relativedelta import relativedelta

from .models import UserSubscription, ReferralReward
from .constants import (
    TRIAL_PERIOD_DAYS,
    REFERRAL_MILESTONES,
    SUBSCRIPTION_PLANS,
)


def create_subscription_for_user(user, *, is_referral: bool = False) -> UserSubscription:
    """
    Creates a subscription for the user upon registration.
    Trial lasts TRIAL_PERIOD_DAYS days; after that the subscription expires and free limits apply.
    """
    sub, created = UserSubscription.objects.get_or_create(
        user=user,
        defaults={
            "price_kopecks": SUBSCRIPTION_PLANS[1]["per_month_kopecks"],
        },
    )

    if not created:
        return sub

    now = timezone.now()
    sub.status = UserSubscription.Status.TRIAL
    sub.is_referral_trial = is_referral
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=TRIAL_PERIOD_DAYS)
    sub.save()

    return sub


def extend_subscription(sub: UserSubscription, months: int) -> None:
    """Extend subscription by the given number of calendar months from current_period_end (or now if expired)."""
    now = timezone.now()
    start = sub.current_period_end if sub.current_period_end and sub.current_period_end > now else now
    sub.current_period_end = start + relativedelta(months=months)
    sub.status = UserSubscription.Status.ACTIVE
    sub.save(update_fields=["current_period_end", "status", "updated_at"])


@transaction.atomic
def award_referral_subscription(inviter, invitee) -> bool:
    """
    On referral registration: invitee gets extended trial; inviter may get
    subscription months when hitting milestones (10→1 mo, 40→6 mo, 80→1 yr).
    """
    if not inviter or not invitee or inviter.pk == invitee.pk:
        return False

    # Lock both users in stable order
    user_ids = sorted([inviter.pk, invitee.pk], key=str)
    users = {
        u.pk: u
        for u in inviter.__class__.objects.select_for_update().filter(pk__in=user_ids)
    }
    locked_inviter = users.get(inviter.pk)
    locked_invitee = users.get(invitee.pk)
    if not locked_inviter or not locked_invitee:
        return False

    invited_count = locked_inviter.referrals.count()

    for tier, months in sorted(REFERRAL_MILESTONES.items()):
        if invited_count >= tier and not ReferralReward.objects.filter(
            user=locked_inviter, tier=tier
        ).exists():
            ReferralReward.objects.create(
                user=locked_inviter,
                tier=tier,
                months_granted=months,
            )
            sub, _ = UserSubscription.objects.get_or_create(
                user=locked_inviter,
                defaults={
                    "price_kopecks": SUBSCRIPTION_PLANS[1]["per_month_kopecks"],
                    "status": UserSubscription.Status.TRIAL,
                },
            )
            extend_subscription(sub, months)

    return True
