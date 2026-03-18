"""Generate 64px and 160px thumbnails for existing avatars (one-time migration)."""
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.chats.models import Chat, Channel
from apps.common.image_utils import create_avatar_thumbnails, get_avatar_thumbnail_path
from apps.users.models import User, UserAvatar


class Command(BaseCommand):
    help = "Create small (64px) and medium (160px) thumbnails for all existing avatars."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only report, do not create files.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        created = 0
        skipped = 0
        failed = 0

        def process(path: str | None, label: str) -> None:
            nonlocal created, skipped, failed
            if not path:
                return
            media_root = Path(settings.MEDIA_ROOT).resolve()
            thumb_small_path = get_avatar_thumbnail_path(path, "small")
            if thumb_small_path and (media_root / thumb_small_path).exists():
                skipped += 1
                return
            if dry_run:
                self.stdout.write(f"Would create thumbnails for {label}: {path}")
                created += 1
                return
            if create_avatar_thumbnails(path):
                created += 1
            else:
                failed += 1
                self.stderr.write(f"Failed: {label} {path}")

        for user in User.objects.filter(avatar__isnull=False).exclude(avatar=""):
            process(user.avatar.name, f"User {user.id}")

        for ua in UserAvatar.objects.exclude(image=""):
            process(ua.image.name, f"UserAvatar {ua.id}")

        for chat in Chat.objects.filter(avatar__isnull=False).exclude(avatar=""):
            process(chat.avatar.name, f"Chat {chat.id}")

        for ch in Channel.objects.filter(avatar__isnull=False).exclude(avatar=""):
            process(ch.avatar.name, f"Channel {ch.id}")

        self.stdout.write(f"Created: {created}, Skipped (already exist): {skipped}, Failed: {failed}")
        if dry_run:
            self.stdout.write("(dry-run — no files created)")
