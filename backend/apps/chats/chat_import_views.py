"""
Импорт истории из Telegram в чаты/группы.
Preview, Import, Manage (список непривязанных), Remap.
"""
import os
import uuid
from pathlib import Path

from django.conf import settings
from django.db.models import Count
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from .models import Chat, ChatMember, Message
from .telegram_import import parse_telegram_export, import_telegram_to_chat
from apps.payments.plan_limits import can_import_telegram, RESTRICTION_CODE

MAX_IMPORT_SIZE = 10 * 1024 * 1024  # 10 MB


def _can_manage_import(chat: Chat, user) -> bool:
    """Кто может импортировать/управлять импортом.

    - Для групп: владелец или админ.
    - Для личных чатов: любой активный участник (оба собеседника).
    """
    if chat.is_personal:
        return ChatMember.objects.filter(
            chat=chat, user=user, status=ChatMember.Status.ACTIVE
        ).exists()
    if chat.owner_id == user.id:
        return True
    return ChatMember.objects.filter(
        chat=chat, user=user, role=ChatMember.Role.ADMIN, status=ChatMember.Status.ACTIVE
    ).exists()


def _get_session_path(session_id: str) -> Path:
    base = Path(settings.MEDIA_ROOT) / "chat_import_sessions"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{session_id}.zip"


class ChatImportTelegramPreviewView(APIView):
    """POST: загрузка ZIP, парсинг, возврат participants и message_count."""

    parser_classes = (MultiPartParser, FormParser)
    permission_classes = []

    def post(self, request, chat_id):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется авторизация."}, status=status.HTTP_401_UNAUTHORIZED)
        chat = get_object_or_404(Chat, id=chat_id, is_active=True)
        if not _can_manage_import(chat, request.user):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        # Premium check only on Import, not on Preview — let user upload and parse first

        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response(
                {"detail": "Передайте ZIP-архив экспорта Telegram (поле file)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (file_obj.name or "").lower().endswith(".zip") is False:
            return Response(
                {"detail": "Файл должен быть ZIP-архивом экспорта Telegram Desktop."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if file_obj.size > MAX_IMPORT_SIZE:
            return Response(
                {"detail": "Файл не должен превышать 10 МБ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session_id = str(uuid.uuid4())
        session_path = _get_session_path(session_id)
        try:
            with open(session_path, "wb") as f:
                for chunk in file_obj.chunks():
                    f.write(chunk)
        except OSError:
            return Response({"detail": "Ошибка сохранения файла."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        result = parse_telegram_export(Path(session_path))
        if result[0] is None:
            try:
                session_path.unlink(missing_ok=True)
            except OSError:
                pass
            return Response(
                {"detail": "Не удалось распарсить архив. Убедитесь, что это экспорт Telegram Desktop."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        participants, message_count = result
        return Response({
            "participants": participants,
            "message_count": message_count,
            "session_id": session_id,
        }, status=status.HTTP_200_OK)


class ChatImportTelegramView(APIView):
    """POST: импорт с session_id и mapping. GET: список непривязанных участников."""

    parser_classes = (MultiPartParser, FormParser, JSONParser)
    permission_classes = []

    def post(self, request, chat_id):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется авторизация."}, status=status.HTTP_401_UNAUTHORIZED)
        chat = get_object_or_404(Chat, id=chat_id, is_active=True)
        if not _can_manage_import(chat, request.user):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if not can_import_telegram(request.user):
            return Response(
                {"detail": "Импорт из Telegram доступен по подписке.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )

        session_id = request.data.get("session_id")
        mapping = request.data.get("mapping") or {}
        if not session_id:
            return Response(
                {"detail": "Передайте session_id и mapping."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session_path = _get_session_path(session_id)
        if not session_path.exists():
            return Response(
                {"detail": "Сессия истекла или не найдена. Загрузите архив заново."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            created_count, errors = import_telegram_to_chat(chat, request.user, Path(session_path), mapping)
            # Сохраняем маппинг для участников, сопоставленных при импорте (для экрана «Управление импортом»)
            stored = dict(chat.telegram_import_mappings or {})
            for tg_user_id, entry in (mapping or {}).items():
                if entry and entry.get("user_id"):
                    display_name = (entry.get("display_name") or "").strip()
                    if display_name:
                        stored[display_name] = str(entry["user_id"])
            if stored:
                chat.telegram_import_mappings = stored
                chat.save(update_fields=["telegram_import_mappings"])
        finally:
            try:
                session_path.unlink(missing_ok=True)
            except OSError:
                pass

        return Response({
            "created": created_count,
            "errors": errors[:20],
        }, status=status.HTTP_200_OK)

    def get(self, request, chat_id):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется авторизация."}, status=status.HTTP_401_UNAUTHORIZED)
        chat = get_object_or_404(Chat, id=chat_id, is_active=True)
        if not _can_manage_import(chat, request.user):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)

        unmapped = (
            Message.objects.filter(chat=chat, sender_display_name__isnull=False)
            .exclude(sender_display_name="")
            .values("sender_display_name")
            .annotate(message_count=Count("id"))
            .order_by("sender_display_name")
        )
        unmapped_list = list(unmapped)
        stored = chat.telegram_import_mappings or {}
        unmapped_names = {u["sender_display_name"] for u in unmapped_list}
        mapped_list = [
            {"display_name": dn, "user_id": uid, "message_count": 0}
            for dn, uid in stored.items()
            if dn and dn not in unmapped_names
        ]
        participants = [
            {"display_name": u["sender_display_name"], "user_id": None, "message_count": u["message_count"]}
            for u in unmapped_list
        ] + sorted(mapped_list, key=lambda x: x["display_name"])
        return Response({
            "participants": participants,
        }, status=status.HTTP_200_OK)

    def patch(self, request, chat_id):
        """Обновить display_name для непривязанного участника или в маппинге."""
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется авторизация."}, status=status.HTTP_401_UNAUTHORIZED)
        chat = get_object_or_404(Chat, id=chat_id, is_active=True)
        if not _can_manage_import(chat, request.user):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)

        data = request.data or {}
        from_name = (data.get("from_name") or "").strip()
        to_name = (data.get("to_name") or "").strip()
        if not from_name or not to_name or from_name == to_name:
            return Response(
                {"detail": "Передайте from_name и to_name (разные строки)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stored = dict(chat.telegram_import_mappings or {})
        if from_name in stored:
            user_id = stored.pop(from_name)
            stored[to_name] = user_id
            chat.telegram_import_mappings = stored
            chat.save(update_fields=["telegram_import_mappings"])
        else:
            updated = Message.objects.filter(
                chat=chat, sender_display_name=from_name
            ).update(sender_display_name=to_name)
            if updated == 0:
                return Response(
                    {"detail": "Участник не найден или уже сопоставлен."},
                    status=status.HTTP_404_NOT_FOUND,
                )
        return Response({"ok": True}, status=status.HTTP_200_OK)


class ChatImportTelegramRemapView(APIView):
    """PATCH: сопоставить display_name с участником чата."""

    parser_classes = (JSONParser,)
    permission_classes = []

    def patch(self, request, chat_id):
        if not request.user.is_authenticated:
            return Response({"detail": "Требуется авторизация."}, status=status.HTTP_401_UNAUTHORIZED)
        chat = get_object_or_404(Chat, id=chat_id, is_active=True)
        if not _can_manage_import(chat, request.user):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)

        data = request.data or {}
        if not isinstance(data, dict):
            return Response({"detail": "Передайте объект { display_name: user_id }."}, status=status.HTTP_400_BAD_REQUEST)

        for display_name, user_id in data.items():
            if not display_name or not user_id:
                continue
            member = ChatMember.objects.filter(
                chat=chat, user_id=user_id, status=ChatMember.Status.ACTIVE
            ).first()
            if not member:
                continue
            updated =             Message.objects.filter(
                chat=chat, sender_display_name=display_name
            ).update(sender=member.user, sender_display_name=None)
            stored = dict(chat.telegram_import_mappings or {})
            stored[display_name] = str(user_id)
            chat.telegram_import_mappings = stored
            chat.save(update_fields=["telegram_import_mappings"])

        return Response({"ok": True}, status=status.HTTP_200_OK)
