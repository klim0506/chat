"""
Импорт истории канала из экспорта Telegram.
Формат: ZIP-архив с result.json и chats/chat_XX/... (структура Telegram Desktop export).
"""
from __future__ import annotations

import json
import mimetypes
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from apps.chats.models import Chat, Channel, ChannelPost, Message
from apps.files.models import FileAttachment
from apps.users.models import User

# Типы чатов Telegram: каналы
CHANNEL_TYPES = {"public_channel", "private_channel"}

# Типы чатов Telegram: группы (для импорта в Chat)
CHAT_GROUP_TYPES = {"private_group", "private_supergroup", "personal_chat"}

# media_type Telegram -> msg_type Pingy
MEDIA_TYPE_MAP = {
    "sticker": Message.MsgType.STICKER,
    "video_message": Message.MsgType.VIDEO_CIRCLE,
    "voice_message": Message.MsgType.AUDIO,
    "animation": Message.MsgType.GIF,
    "video_file": Message.MsgType.VIDEO,
    "audio_file": Message.MsgType.AUDIO,
}


def _extract_text(msg: dict) -> str:
    """Извлечь текст из сообщения. text может быть строкой или массивом [plain, entity]."""
    text = msg.get("text")
    if not text:
        return ""
    if isinstance(text, str):
        return text.strip()
    parts = []
    for item in text:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            parts.append(item.get("text", ""))
    return "".join(parts).strip()


def _parse_date(msg: dict) -> datetime | None:
    """Парсинг даты сообщения из date_unixtime или date."""
    ts = msg.get("date_unixtime")
    if ts is not None:
        try:
            t = int(ts)
            return datetime.fromtimestamp(t, tz=timezone.get_current_timezone())
        except (ValueError, TypeError):
            pass
    dt_str = msg.get("date")
    if dt_str:
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            return dt
        except (ValueError, TypeError):
            pass
    return None


def _get_media_path(msg: dict, extract_root: Path) -> Path | None:
    """Вернуть путь к медиа-файлу. Используется photo, file или thumbnail."""
    root = extract_root.resolve()
    for key in ("photo", "file", "thumbnail"):
        rel = msg.get(key)
        if rel and isinstance(rel, str):
            p = (extract_root / rel.replace("/", os.sep)).resolve()
            try:
                if p.exists() and p.relative_to(root):
                    return p
            except ValueError:
                pass  # path outside root
    return None


def _msg_type_from_message(msg: dict, media_path: Path | None) -> str:
    """Определить msg_type по media_type, пути и MIME."""
    media_type = msg.get("media_type")
    if media_type and media_type in MEDIA_TYPE_MAP:
        return MEDIA_TYPE_MAP[media_type]
    if media_path:
        mime, _ = mimetypes.guess_type(str(media_path))
        if mime:
            if mime.startswith("image/"):
                return Message.MsgType.FILE
            if mime.startswith("video/"):
                return Message.MsgType.VIDEO
            if mime.startswith("audio/"):
                return Message.MsgType.AUDIO
    return Message.MsgType.TEXT


def _create_file_attachment(
    user,
    source_path: Path,
    rel_dir: str,
) -> FileAttachment | None:
    """Создать FileAttachment, скопировав файл в MEDIA_ROOT."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    os.makedirs(media_root / rel_dir, exist_ok=True)
    ext = source_path.suffix or ""
    new_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(rel_dir, new_name).replace("\\", "/")
    dest = (media_root / file_path).resolve()
    try:
        shutil.copy2(source_path, dest)
    except OSError:
        return None
    size = dest.stat().st_size
    mime, _ = mimetypes.guess_type(str(source_path))
    mime = mime or "application/octet-stream"

    att = FileAttachment.objects.create(
        uploader=user,
        original_name=source_path.name,
        file_path=file_path,
        mime_type=mime,
        size_bytes=size,
        storage_type=FileAttachment.StorageType.LOCAL,
        scan_status=FileAttachment.ScanStatus.CLEAN,
        is_encrypted=False,
    )
    return att


def _get_chats_from_result(result: dict) -> list[dict]:
    """Получить список чатов из result.json (полный экспорт или один чат)."""
    chats_obj = result.get("chats")
    if chats_obj is None:
        # Один чат: result.json — сам объект Chat
        if "messages" in result and "id" in result:
            return [result]
        return []
    list_chats = chats_obj.get("list", []) if isinstance(chats_obj, dict) else []
    if isinstance(chats_obj, list):
        list_chats = chats_obj
    return list_chats


def _find_result_json(root: Path) -> Path | None:
    """Найти result.json рекурсивно, вернуть директорию, в которой он лежит."""
    for p in root.rglob("result.json"):
        return p.parent
    return None


def _parse_from_id(from_id: str) -> str | None:
    """Извлечь tg_user_id из from_id (например 'user429811584' -> '429811584')."""
    if not from_id or not isinstance(from_id, str):
        return None
    if from_id.startswith("user"):
        return from_id[4:]  # "user429811584" -> "429811584"
    return None


def parse_telegram_export(zip_path: Path) -> tuple[list[dict], int] | tuple[None, None]:
    """
    Парсинг экспорта Telegram без создания записей (для превью).
    Возвращает (participants, message_count) или (None, None) при ошибке.
    participants: [{ "tg_user_id": str, "tg_display_name": str }]
    """
    with tempfile.TemporaryDirectory(prefix="tg_parse_") as tmp:
        extract_root = Path(tmp)
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_root)
        except (zipfile.BadZipFile, OSError):
            return (None, None)

        result_path = _find_result_json(extract_root)
        if result_path is None:
            return (None, None)

        result_file = result_path / "result.json"
        if not result_file.exists():
            return (None, None)

        try:
            with open(result_file, "r", encoding="utf-8") as f:
                result = json.load(f)
        except (json.JSONDecodeError, OSError):
            return (None, None)

        chats = _get_chats_from_result(result)
        group_chats = [c for c in chats if c.get("type") in CHAT_GROUP_TYPES]
        if not group_chats:
            group_chats = chats  # fallback: берём все

        participants_map: dict[str, str] = {}  # tg_user_id -> tg_display_name
        message_count = 0

        for chat in group_chats:
            messages = chat.get("messages") or []
            for msg in messages:
                if not isinstance(msg, dict) or msg.get("type") != "message":
                    continue
                from_id = msg.get("from_id") or msg.get("actor_id")
                tg_user_id = _parse_from_id(from_id)
                from_name = msg.get("from") or msg.get("actor") or ""
                if tg_user_id:
                    participants_map.setdefault(tg_user_id, from_name or f"user{tg_user_id}")
                message_count += 1

        participants = [
            {"tg_user_id": tid, "tg_display_name": name}
            for tid, name in participants_map.items()
        ]
        return (participants, message_count)


def _parse_and_get_messages(extract_root: Path) -> tuple[list[dict], Path] | tuple[None, None]:
    """Распарсить извлечённый архив, вернуть (sorted_messages, result_path)."""
    result_path = _find_result_json(extract_root)
    if result_path is None:
        return (None, None)
    result_file = result_path / "result.json"
    if not result_file.exists():
        return (None, None)
    try:
        with open(result_file, "r", encoding="utf-8") as f:
            result = json.load(f)
    except (json.JSONDecodeError, OSError):
        return (None, None)
    chats = _get_chats_from_result(result)
    group_chats = [c for c in chats if c.get("type") in CHAT_GROUP_TYPES]
    if not group_chats:
        group_chats = chats
    all_messages: list[dict] = []
    for chat in group_chats:
        for msg in chat.get("messages") or []:
            if isinstance(msg, dict) and msg.get("type") == "message":
                all_messages.append(msg)
    sorted_messages = sorted(
        all_messages,
        key=lambda m: (_parse_date(m) or timezone.now()).timestamp(),
    )
    return (sorted_messages, result_path)


def import_telegram_to_chat(
    chat: Chat,
    user,
    zip_path: Path,
    mapping: dict,
) -> tuple[int, list[str]]:
    """
    Импортировать историю из ZIP в чат (группу) с учётом маппинга.
    mapping: { tg_user_id: { "display_name": str, "user_id": uuid|None } }
    Возвращает (created_count, errors).
    """
    with tempfile.TemporaryDirectory(prefix="tg_import_") as tmp:
        extract_root = Path(tmp)
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_root)
        except (zipfile.BadZipFile, OSError):
            return 0, ["Некорректный или повреждённый ZIP-архив."]

        parsed = _parse_and_get_messages(extract_root)
        if parsed[0] is None:
            return 0, ["Не найден result.json. Убедитесь, что архив — экспорт Telegram Desktop."]
        messages, result_path = parsed

        errors: list[str] = []
        created_count = 0
        rel_dir = os.path.join("chat_imports", str(chat.id))
        reply_map: dict[int, Message] = {}  # tg_msg_id -> Message для reply_to

        for msg in messages:
            try:
                from_id = msg.get("from_id") or msg.get("actor_id")
                tg_user_id = _parse_from_id(from_id)
                map_entry = mapping.get(str(tg_user_id)) if tg_user_id else None

                if map_entry and map_entry.get("user_id"):
                    sender = User.objects.filter(id=map_entry["user_id"]).first() or chat.owner
                    sender_display_name = None
                else:
                    sender = chat.owner
                    sender_display_name = (
                        (map_entry or {}).get("display_name")
                        or msg.get("from")
                        or msg.get("actor")
                        or "Неизвестный"
                    )

                created_at = _parse_date(msg) or timezone.now()
                edited_at = None
                if msg.get("edited_unixtime"):
                    try:
                        edited_at = datetime.fromtimestamp(int(msg["edited_unixtime"]), tz=timezone.get_current_timezone())
                    except (ValueError, TypeError):
                        pass

                text = _extract_text(msg)
                media_path = _get_media_path(msg, result_path)
                msg_type = _msg_type_from_message(msg, media_path)
                if media_path and msg_type == Message.MsgType.TEXT:
                    msg_type = Message.MsgType.FILE

                file_att = None
                if media_path:
                    file_att = _create_file_attachment(user, media_path, rel_dir)
                    if file_att and not text:
                        text = ""

                reply_to_msg = None
                reply_to_id = msg.get("reply_to_message_id")
                if reply_to_id is not None:
                    reply_to_msg = reply_map.get(reply_to_id)

                m = Message.objects.create(
                    chat=chat,
                    sender=sender,
                    sender_display_name=sender_display_name or None,
                    msg_type=msg_type,
                    content=text or "",
                    file=file_att,
                    reply_to=reply_to_msg,
                    created_at=created_at,
                    edited_at=edited_at,
                )
                reply_map[msg.get("id")] = m
                created_count += 1
            except Exception as e:
                errors.append(f"Сообщение {msg.get('id', '?')}: {e}")

        chat.has_telegram_import = True
        chat.save(update_fields=["has_telegram_import"])
        return created_count, errors


def import_telegram_export(
    channel: Channel,
    user,
    zip_path: Path,
) -> tuple[int, list[str]]:
    """
    Импортировать историю из ZIP-архива экспорта Telegram.
    Возвращает (количество импортированных постов, список ошибок).
    """
    errors: list[str] = []
    created_count = 0
    rel_dir = os.path.join("channel_imports", str(channel.id))
    media_root = Path(settings.MEDIA_ROOT).resolve()

    with tempfile.TemporaryDirectory(prefix="tg_import_") as tmp:
        extract_root = Path(tmp)
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_root)
        except zipfile.BadZipFile as e:
            return 0, [f"Некорректный ZIP: {e}"]
        except OSError as e:
            return 0, [f"Ошибка распаковки: {e}"]

        result_file = extract_root / "result.json"
        if not result_file.exists():
            return 0, ["Не найден result.json в архиве. Убедитесь, что архив — экспорт Telegram Desktop."]

        try:
            with open(result_file, "r", encoding="utf-8") as f:
                result = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            return 0, [f"Ошибка чтения result.json: {e}"]

        chats = _get_chats_from_result(result)
        channel_chats = [c for c in chats if c.get("type") in CHANNEL_TYPES]
        if not channel_chats:
            channel_chats = chats  # Берём все чаты, если каналов нет (часто при экспорте одного чата)

        for chat in channel_chats:
            messages = chat.get("messages") or []
            # Сортируем по дате (старые первые) для корректного порядка
            sorted_msgs = sorted(
                (m for m in messages if isinstance(m, dict) and m.get("type") == "message"),
                key=lambda m: (_parse_date(m) or timezone.now()).timestamp(),
            )

            for msg in sorted_msgs:
                try:
                    created_at = _parse_date(msg) or timezone.now()
                    text = _extract_text(msg)
                    media_path = _get_media_path(msg, extract_root)

                    msg_type = _msg_type_from_message(msg, media_path)
                    if media_path and msg_type == Message.MsgType.TEXT:
                        msg_type = Message.MsgType.FILE

                    file_att = None
                    if media_path:
                        file_att = _create_file_attachment(user, media_path, rel_dir)
                        if file_att and not text:
                            text = ""  # пост с медиа без текста

                    post = ChannelPost.objects.create(
                        channel=channel,
                        author=channel.owner,
                        msg_type=msg_type,
                        content=text or "",
                        file=file_att,
                        created_at=created_at,
                    )
                    created_count += 1
                except Exception as e:
                    errors.append(f"Сообщение {msg.get('id', '?')}: {e}")

    return created_count, errors
