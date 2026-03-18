"""
Create the @support technical support account.

Usage: python manage.py create_support_user

Uses SUPPORT_PHONE from environment (e.g. +70000000000) or a default placeholder.
The account has username=support, dm_privacy=everyone so anyone can write DMs.
"""
import os
import secrets
from django.core.management.base import BaseCommand

from apps.users.models import User


SUPPORT_USERNAME = "support"
DEFAULT_PHONE = "+70000000000"


class Command(BaseCommand):
    help = "Create the @support technical support account."

    def add_arguments(self, parser):
        parser.add_argument(
            "--phone",
            type=str,
            default=None,
            help="Phone number for support account (default: SUPPORT_PHONE env or +70000000000)",
        )

    def handle(self, *args, **options):
        phone = options.get("phone") or os.environ.get("SUPPORT_PHONE") or DEFAULT_PHONE
        phone = str(phone).strip()
        if not phone.startswith("+"):
            phone = "+" + phone

        existing = User.objects.filter(username__iexact=SUPPORT_USERNAME).first()
        if existing:
            self.stdout.write(
                self.style.WARNING(
                    f"User @{SUPPORT_USERNAME} already exists (id={existing.id}, phone={existing.phone})."
                )
            )
            return

        existing_phone = User.objects.filter(phone=phone).first()
        if existing_phone:
            self.stdout.write(
                self.style.ERROR(
                    f"Phone {phone} is already used by another user (username={existing_phone.username}). "
                    "Use a different SUPPORT_PHONE or --phone."
                )
            )
            return

        password = secrets.token_urlsafe(24)
        user = User.objects.create_user(
            phone=phone,
            password=password,
            username=SUPPORT_USERNAME,
            display_name="Pingy Support",
            dm_privacy=User.DM_PRIVACY_EVERYONE,
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created @{SUPPORT_USERNAME} (id={user.id}, phone={user.phone})."
            )
        )
        self.stdout.write(
            f"Password (save it): {password}\n"
            "Use Django admin or reset if lost."
        )
