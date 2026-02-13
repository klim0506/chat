"""
Сервис подписок и звёзд.
"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone

from .models import UserSubscription, StarTransaction
from .constants import (
    SUBSCRIPTION_PRICE_KOPECKS,
    TRIAL_PERIOD_DAYS,
    REFERRAL_TRIAL_PERIOD_DAYS,
    STARS_PER_REFERRAL_INVITER,
    STARS_PER_REFERRAL_INVITEE,
    STARS_COST_10_TO_100,
    STARS_COST_100_TO_1000,
    CHAT_EXPANSION_PERMANENT_DAYS,
)


def create_subscription_for_user(user, *, is_referral: bool = False) -> UserSubscription:
    """
    Создаёт подписку пользователю при регистрации.
    - Обычная регистрация: trial на 7 дней
    - По реферальной ссылке: trial на 14 дней
    """
    sub, created = UserSubscription.objects.get_or_create(
        user=user,
        defaults={
            "price_kopecks": SUBSCRIPTION_PRICE_KOPECKS,
        },
    )

    if not created:
        return sub

    now = timezone.now()
    trial_days = REFERRAL_TRIAL_PERIOD_DAYS if is_referral else TRIAL_PERIOD_DAYS
    sub.status = UserSubscription.Status.TRIAL
    sub.is_referral_trial = is_referral
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=trial_days)
    sub.save()

    return sub


@transaction.atomic
def award_referral_stars(inviter, invitee):
    """
    Начисляет звёзды при реферальной регистрации.
    inviter (пригласивший) → +10 звёзд
    invitee (приглашённый) → +10 звёзд
    """
    if not inviter or not invitee or inviter.pk == invitee.pk:
        return False

    # Блокируем обоих пользователей в стабильном порядке, чтобы избежать дублей в гонках.
    user_ids = sorted([inviter.pk, invitee.pk], key=str)
    users = {
        u.pk: u
        for u in inviter.__class__.objects.select_for_update().filter(pk__in=user_ids)
    }
    locked_inviter = users.get(inviter.pk)
    locked_invitee = users.get(invitee.pk)
    if not locked_inviter or not locked_invitee:
        return False

    inviter_tx_exists = StarTransaction.objects.filter(
        user=locked_inviter,
        reason=StarTransaction.Reason.REFERRAL_INVITER,
        related_user=locked_invitee,
    ).exists()
    invitee_tx_exists = StarTransaction.objects.filter(
        user=locked_invitee,
        reason=StarTransaction.Reason.REFERRAL_INVITEE,
        related_user=locked_inviter,
    ).exists()
    if inviter_tx_exists or invitee_tx_exists:
        return False

    # Пригласивший
    locked_inviter.stars += STARS_PER_REFERRAL_INVITER
    locked_inviter.save(update_fields=["stars"])
    StarTransaction.objects.create(
        user=locked_inviter,
        amount=STARS_PER_REFERRAL_INVITER,
        reason=StarTransaction.Reason.REFERRAL_INVITER,
        description=f"Пригласил {locked_invitee.phone}",
        related_user=locked_invitee,
    )

    # Приглашённый
    locked_invitee.stars += STARS_PER_REFERRAL_INVITEE
    locked_invitee.save(update_fields=["stars"])
    StarTransaction.objects.create(
        user=locked_invitee,
        amount=STARS_PER_REFERRAL_INVITEE,
        reason=StarTransaction.Reason.REFERRAL_INVITEE,
        description=f"Зарегистрировался по ссылке {locked_inviter.phone}",
        related_user=locked_inviter,
    )
    return True


@transaction.atomic
def expand_chat(user, chat, target_tier: int) -> dict:
    """
    Прокачивает чат звёздами: 10→100 за 50 звёзд, 100→1000 за 100 звёзд (раз и навсегда).
    target_tier: 100 или 1000.
    """
    from apps.chats.models import DEFAULT_MAX_MEMBERS, EXPANSION_TIER_100, EXPANSION_TIER_1000

    if target_tier == EXPANSION_TIER_100:
        cost = STARS_COST_10_TO_100
    elif target_tier == EXPANSION_TIER_1000:
        cost = STARS_COST_100_TO_1000
    else:
        return {"ok": False, "detail": "Допустимые уровни: 100 или 1000."}

    current = chat.effective_max_members
    if target_tier == EXPANSION_TIER_100 and current >= 100:
        return {"ok": False, "detail": "Чат уже расширен до 100 или выше."}
    if target_tier == EXPANSION_TIER_1000 and current >= 1000:
        return {"ok": False, "detail": "Чат уже расширен до 1000."}

    if user.stars < cost:
        return {"ok": False, "detail": f"Недостаточно звёзд. Нужно {cost}, у вас {user.stars}."}

    if chat.owner_id != user.id:
        return {"ok": False, "detail": "Только владелец чата может расширить его."}

    now = timezone.now()
    chat.expanded_until = now + timedelta(days=CHAT_EXPANSION_PERMANENT_DAYS)

    chat.expansion_tier = target_tier
    chat.save(update_fields=["expanded_until", "expansion_tier"])

    user.stars -= cost
    user.save(update_fields=["stars"])

    tier_label = "100" if target_tier == EXPANSION_TIER_100 else "1000"
    StarTransaction.objects.create(
        user=user,
        amount=-cost,
        reason=StarTransaction.Reason.CHAT_EXPANSION,
        description=f"Прокачка чата «{chat.title}» до {tier_label} участников навсегда",
        related_chat=chat,
    )

    return {
        "ok": True,
        "expanded_until": chat.expanded_until.isoformat(),
        "stars_remaining": user.stars,
        "effective_max_members": target_tier,
    }
