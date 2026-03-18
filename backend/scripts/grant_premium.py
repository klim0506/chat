#!/usr/bin/env python
"""Выдать Premium пользователю по username или phone. Запуск: cd backend && DJANGO_SETTINGS_MODULE=config.settings.prod .venv/bin/python scripts/grant_premium.py test_user_e2e"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

import django
django.setup()

from django.utils import timezone
from dateutil.relativedelta import relativedelta

from apps.users.models import User
from apps.payments.models import UserSubscription


def grant_premium(identifier: str, months: int = 12):
    if identifier.startswith("+") or identifier.isdigit():
        user = User.objects.filter(phone=identifier).first()
    else:
        user = User.objects.filter(username=identifier).first()
    if not user:
        print(f"User not found: {identifier}")
        return
    sub, _ = UserSubscription.objects.get_or_create(
        user=user,
        defaults={"status": UserSubscription.Status.TRIAL},
    )
    now = timezone.now()
    start = sub.current_period_end if sub.current_period_end and sub.current_period_end > now else now
    sub.current_period_end = start + relativedelta(months=months)
    sub.status = UserSubscription.Status.ACTIVE
    sub.save(update_fields=["current_period_end", "status", "updated_at"])
    print(f"Premium granted: {user.username or user.phone} until {sub.current_period_end}")


if __name__ == "__main__":
    id_ = sys.argv[1] if len(sys.argv) > 1 else "test_user_e2e"
    grant_premium(id_, months=12)
