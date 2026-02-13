from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.chats.models import Message
from apps.files.models import FileAttachment


class Command(BaseCommand):
    help = "Attach missing file_id for file messages by matching uploader + original_name + timestamp proximity."

    def add_arguments(self, parser):
        parser.add_argument("--minutes", type=int, default=10, help="Time window in minutes to match files.")
        parser.add_argument("--dry-run", action="store_true", help="Do not modify DB, only report.")

    def handle(self, *args, **options):
        window_minutes = max(1, int(options["minutes"]))
        dry_run = options["dry_run"]
        window = timedelta(minutes=window_minutes)
        now = timezone.now()

        qs = (
            Message.objects.filter(msg_type=Message.MsgType.FILE, file__isnull=True)
            .exclude(content__isnull=True)
            .exclude(content__exact="")
            .select_related("sender")
        )

        updated = 0
        checked = 0
        for msg in qs.iterator():
            checked += 1
            # Skip very old data by default (prevent surprises)
            if msg.created_at < now - timedelta(days=90):
                continue
            candidates = (
                FileAttachment.objects.filter(
                    uploader_id=msg.sender_id,
                    original_name=msg.content,
                    created_at__gte=msg.created_at - window,
                    created_at__lte=msg.created_at + window,
                )
                .order_by("created_at")
            )
            att = candidates.first()
            if not att:
                continue
            if dry_run:
                self.stdout.write(f"[dry-run] Would link message {msg.id} -> file {att.id}")
                updated += 1
                continue
            with transaction.atomic():
                msg.file = att
                msg.save(update_fields=["file"])
                updated += 1

        self.stdout.write(f"Checked: {checked}. Updated: {updated}. Dry-run: {dry_run}. Window: {window_minutes}m.")
