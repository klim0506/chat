"""
Заполняет Message.duration_seconds для старых сообщений (audio / video / video_circle),
где поле в БД пустое: длительность берётся с локального файла через ffprobe.

Требуется установленный ffprobe (пакет ffmpeg):
  apt-get install -y ffmpeg

Запуск (из каталога backend):
  python manage.py backfill_message_duration
  python manage.py backfill_message_duration --dry-run
  python manage.py backfill_message_duration --limit 500
  python manage.py backfill_message_duration --force  # пересчитать даже если duration уже есть

Пропускает: удалённые сообщения, файлы без локального пути, E2EE-шифрованные вложения.
"""
from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from django.core.management.base import BaseCommand
from apps.chats.models import Message
from apps.files.models import FileAttachment
from apps.files.tasks import _resolve_local_path


def _duration_from_ffprobe(path: Path) -> float | None:
    """Возвращает длительность в секундах или None, если не удалось прочитать."""
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if out.returncode != 0:
            return None
        raw = (out.stdout or "").strip()
        if not raw:
            return None
        d = float(raw)
        if not math.isfinite(d) or d <= 0 or d > 86400:
            return None
        return round(d, 3)
    except (ValueError, subprocess.TimeoutExpired, OSError):
        return None


class Command(BaseCommand):
    help = "Заполняет duration_seconds у сообщений с аудио/видео по файлам на диске (ffprobe)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет обновлено, без записи в БД.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Максимум сообщений для обработки (для теста).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Пересчитать длительность даже если duration_seconds уже задан.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        limit = options["limit"]
        force = options["force"]

        if not shutil.which("ffprobe"):
            self.stderr.write(
                self.style.ERROR(
                    "ffprobe не найден в PATH. Установите ffmpeg: "
                    "apt-get install -y ffmpeg  (или apk add ffmpeg в Alpine)"
                )
            )
            return

        media_types = (
            Message.MsgType.AUDIO,
            Message.MsgType.VIDEO,
            Message.MsgType.VIDEO_CIRCLE,
        )

        qs = (
            Message.objects.filter(
                is_deleted=False,
                file__isnull=False,
                msg_type__in=media_types,
                file__is_encrypted=False,
            )
            .exclude(file__file_path="")
            .select_related("file")
        )
        if not force:
            qs = qs.filter(duration_seconds__isnull=True)

        qs = qs.order_by("created_at")
        if limit is not None:
            qs = qs[: max(0, limit)]

        self.stdout.write(f"Выборка подготовлена (limit={limit}, force={force}, dry_run={dry_run}).")

        buffer: list[Message] = []
        dry_run_count = 0
        skipped = 0
        failed = 0
        saved_total = 0
        flush_every = 500

        def flush() -> None:
            nonlocal buffer, saved_total
            if dry_run or not buffer:
                return
            Message.objects.bulk_update(buffer, ["duration_seconds"], batch_size=500)
            saved_total += len(buffer)
            buffer.clear()

        for msg in qs.iterator(chunk_size=200):
            att: FileAttachment | None = msg.file
            if not att:
                skipped += 1
                continue
            if att.storage_type != FileAttachment.StorageType.LOCAL:
                skipped += 1
                continue
            full = _resolve_local_path(att)
            if not full:
                skipped += 1
                continue
            mime = (att.mime_type or "").lower()
            is_media_mime = mime.startswith("audio/") or mime.startswith("video/")
            is_circle = msg.msg_type == Message.MsgType.VIDEO_CIRCLE
            if not is_media_mime and not is_circle:
                skipped += 1
                continue

            duration = _duration_from_ffprobe(full)
            if duration is None:
                self.stderr.write(
                    self.style.WARNING(f"Не удалось прочитать длительность: msg={msg.id} path={full}")
                )
                failed += 1
                continue

            msg.duration_seconds = duration
            if dry_run:
                dry_run_count += 1
                self.stdout.write(f"  [dry-run] {msg.id} -> {duration}s ({full.name})")
            else:
                buffer.append(msg)
                if len(buffer) >= flush_every:
                    flush()

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Сухой прогон: готово к обновлению {dry_run_count}, пропущено {skipped}, ошибок чтения {failed}."
                )
            )
            return

        flush()
        if saved_total == 0:
            self.stdout.write(self.style.WARNING("Нечего обновлять."))
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Обновлено сообщений: {saved_total}, пропущено {skipped}, ошибок чтения {failed}."
            )
        )
