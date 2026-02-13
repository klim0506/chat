"""
Очистка всех данных: сначала создаётся резервная копия БД, затем удаляются
пользователи и каскадно все связанные данные (чаты, сообщения, подписки, файлы).

Запуск: python manage.py clear_all_data
Без подтверждения: python manage.py clear_all_data --no-input
Без резервной копии (не рекомендуется): python manage.py clear_all_data --no-backup
"""
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.users.models import User


def make_backup_sqlite(db_path: Path, backup_dir: Path) -> Path:
    """Копия файла SQLite с временной меткой."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    name = db_path.stem + f"_backup_{stamp}" + db_path.suffix
    dest = backup_dir / name
    shutil.copy2(db_path, dest)
    return dest


def make_backup_postgres(backup_dir: Path) -> Path:
    """Дамп PostgreSQL через pg_dump."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest = backup_dir / f"pg_backup_{stamp}.sql"
    db = settings.DATABASES["default"]
    env = os.environ.copy()
    if db.get("PASSWORD"):
        env["PGPASSWORD"] = db["PASSWORD"]
    cmd = [
        "pg_dump",
        "-h", db.get("HOST", "localhost"),
        "-p", str(db.get("PORT", 5432)),
        "-U", db.get("USER", "postgres"),
        "-d", db.get("NAME", "postgres"),
        "-f", str(dest),
        "--no-owner",
        "--no-acl",
    ]
    subprocess.run(cmd, env=env, check=True)
    return dest


class Command(BaseCommand):
    help = (
        "Создаёт резервную копию БД, затем удаляет всех пользователей и каскадно "
        "все связанные данные (чаты, сообщения, подписки, файлы)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-input",
            action="store_true",
            help="Не спрашивать подтверждение.",
        )
        parser.add_argument(
            "--no-backup",
            action="store_true",
            help="Не создавать резервную копию перед очисткой (не рекомендуется).",
        )
        parser.add_argument(
            "--backup-dir",
            type=str,
            default=None,
            help="Каталог для резервных копий (по умолчанию: backend/backups).",
        )

    def handle(self, *args, **options):
        if not options["no_input"]:
            confirm = input(
                "Создать копию БД и удалить ВСЕ данные (пользователи, чаты, сообщения, подписки)? [y/N]: "
            )
            if confirm.strip().lower() != "y":
                self.stdout.write("Отменено.")
                return

        backup_path = None
        if not options["no_backup"]:
            backup_dir = options["backup_dir"]
            if backup_dir is None:
                backup_dir = Path(settings.BASE_DIR) / "backups"
            else:
                backup_dir = Path(backup_dir)

            engine = settings.DATABASES["default"]["ENGINE"]
            if "sqlite" in engine:
                db_name = settings.DATABASES["default"]["NAME"]
                db_path = Path(db_name) if not isinstance(db_name, Path) else db_name
                if not db_path.is_absolute():
                    db_path = Path(settings.BASE_DIR) / db_name
                try:
                    backup_path = make_backup_sqlite(db_path, backup_dir)
                    self.stdout.write(self.style.SUCCESS(f"Резервная копия: {backup_path}"))
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f"Ошибка создания копии: {e}"))
                    if not options["no_input"]:
                        confirm = input("Всё равно очистить без копии? [y/N]: ")
                        if confirm.strip().lower() != "y":
                            return
            elif "postgresql" in engine or "postgres" in engine:
                try:
                    backup_path = make_backup_postgres(backup_dir)
                    self.stdout.write(self.style.SUCCESS(f"Резервная копия: {backup_path}"))
                except FileNotFoundError:
                    self.stderr.write(
                        self.style.ERROR("pg_dump не найден. Установите PostgreSQL client или используйте --no-backup.")
                    )
                    return
                except subprocess.CalledProcessError as e:
                    self.stderr.write(self.style.ERROR(f"Ошибка pg_dump: {e}"))
                    return
            else:
                self.stdout.write(self.style.WARNING("Резервная копия для данной БД не реализована. Очистка без копии."))

        count = User.objects.count()
        User.objects.all().delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Удалено пользователей: {count}. Все связанные данные удалены каскадно."
            )
        )
        if backup_path:
            self.stdout.write(self.style.SUCCESS(f"Восстановление: скопируйте {backup_path} на db.sqlite3 или загрузите .sql в PostgreSQL."))
