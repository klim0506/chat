"""
Удаление сообщений и постов, содержащих файлы (когда файлы потеряны и вызывают ошибки).

Запуск: python manage.py cleanup_messages_with_files
Сухой прогон: python manage.py cleanup_messages_with_files --dry-run
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from apps.chats.models import Message, ChannelPost, ChannelPostComment


class Command(BaseCommand):
    help = "Удаляет сообщения и посты с файлами (file или files), когда файлы потеряны."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет удалено, без изменений.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        # Сообщения с одним файлом или несколькими
        msg_qs = Message.objects.filter(
            Q(file__isnull=False) | Q(files__isnull=False)
        ).distinct()
        msg_count = msg_qs.count()

        # Посты каналов
        post_qs = ChannelPost.objects.filter(
            Q(file__isnull=False) | Q(files__isnull=False)
        ).distinct()
        post_count = post_qs.count()

        # Комментарии к постам
        comment_qs = ChannelPostComment.objects.filter(
            Q(file__isnull=False) | Q(files__isnull=False)
        ).distinct()
        comment_count = comment_qs.count()

        self.stdout.write(
            f"Найдено: {msg_count} сообщений, {post_count} постов, {comment_count} комментариев с файлами."
        )

        if msg_count == 0 and post_count == 0 and comment_count == 0:
            self.stdout.write(self.style.SUCCESS("Нечего удалять."))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING("Режим --dry-run: изменения не применены."))
            return

        with transaction.atomic():
            msg_qs.delete()
            self.stdout.write(self.style.SUCCESS(f"Удалено сообщений: {msg_count}"))

            post_qs.delete()
            self.stdout.write(self.style.SUCCESS(f"Удалено постов: {post_count}"))

            comment_qs.delete()
            self.stdout.write(self.style.SUCCESS(f"Удалено комментариев: {comment_count}"))

        self.stdout.write(self.style.SUCCESS("Готово."))
