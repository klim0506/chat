"""
Привести тестовые аккаунты к нужному состоянию:
- +70000000001 — с подпиской (Premium, полный функционал)
- +70000000002 — без подписки (Free, ограниченный функционал)

Использование: python manage.py ensure_test_accounts
"""
from django.core.management.base import BaseCommand

from apps.users.models import User
from apps.payments.models import UserSubscription
from apps.payments.services import create_subscription_for_user


PHONE_PREMIUM = "+70000000001"
PHONE_FREE = "+70000000002"


class Command(BaseCommand):
    help = "Ensure test accounts: +70000000001 with subscription, +70000000002 without."

    def handle(self, *args, **options):
        for phone, label, with_sub in (
            (PHONE_PREMIUM, "Premium (with subscription)", True),
            (PHONE_FREE, "Free (no subscription)", False),
        ):
            user = User.objects.filter(phone=phone).first()
            if not user:
                self.stdout.write(self.style.WARNING(f"User {phone} not found, skip."))
                continue

            sub = UserSubscription.objects.filter(user=user).first()
            if with_sub:
                if sub and sub.is_valid:
                    self.stdout.write(self.style.SUCCESS(f"{phone} ({label}): subscription already active."))
                else:
                    if sub:
                        sub.status = UserSubscription.Status.TRIAL
                        sub.current_period_end = None
                        sub.save(update_fields=["status", "current_period_end", "updated_at"])
                        self.stdout.write(self.style.SUCCESS(f"{phone} ({label}): subscription restored."))
                    else:
                        create_subscription_for_user(user)
                        self.stdout.write(self.style.SUCCESS(f"{phone} ({label}): subscription created."))
            else:
                if not sub:
                    self.stdout.write(self.style.SUCCESS(f"{phone} ({label}): no subscription, OK."))
                else:
                    sub.delete()
                    self.stdout.write(self.style.SUCCESS(f"{phone} ({label}): subscription removed."))
