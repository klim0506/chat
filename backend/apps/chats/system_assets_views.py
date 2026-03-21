"""System assets API — эмодзи и стикеры в chat_uploads/system/. Только is_staff может редактировать."""
import uuid
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.files.models import FileAttachment
from apps.files.access_handles import make_file_handle

from .models import SystemEmoji, SystemSticker


def _file_to_dict(att):
    """Сериализация файла с access_handle для фронта (MediaImage/resolveMediaAccess)."""
    if not att:
        return None
    handle = att.external_url or make_file_handle(att.id)
    return {
        "id": str(att.id),
        "access_handle": handle,
        "url": handle,
        "mime_type": att.mime_type or "",
        "original_name": att.original_name or "",
    }


def _require_staff(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        return Response({"detail": "Только администраторы могут управлять системными ресурсами."}, status=status.HTTP_403_FORBIDDEN)
    return None


# --- System Emojis ---


class SystemEmojiListView(APIView):
    """GET: список системных эмодзи (все пользователи). POST: добавить (только staff)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = SystemEmoji.objects.select_related("file").order_by("category", "position", "created_at")
        data = [
            {
                "id": str(item.id),
                "emoji": item.emoji,
                "shortcode": item.shortcode or "",
                "category": item.category,
                "position": item.position,
                "file": _file_to_dict(item.file),
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ]
        return Response(data)

    def post(self, request):
        err = _require_staff(request)
        if err:
            return err
        file_id_raw = request.data.get("file_id")
        if not file_id_raw:
            return Response({"detail": "Укажите file_id (загруженный с storage_context=system_emoji)."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            file_id = uuid.UUID(str(file_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный file_id."}, status=status.HTTP_400_BAD_REQUEST)
        att = FileAttachment.objects.filter(id=file_id).first()
        if not att:
            return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        if not att.file_path.startswith("chat_uploads/system/emojis/"):
            return Response({"detail": "Файл должен быть загружен в системное хранилище эмодзи."}, status=status.HTTP_400_BAD_REQUEST)
        mime = (att.mime_type or "").lower()
        if not mime.startswith("image/"):
            return Response({"detail": "Эмодзи должен быть изображением (PNG, WebP и т.д.)."}, status=status.HTTP_400_BAD_REQUEST)

        emoji = (request.data.get("emoji") or "").strip()[:32]
        shortcode = (request.data.get("shortcode") or "").strip()[:64]
        category = (request.data.get("category") or "smileys-people").strip()[:64]

        if not emoji:
            return Response({"detail": "Укажите emoji (Unicode символ)."}, status=status.HTTP_400_BAD_REQUEST)

        max_pos = SystemEmoji.objects.filter(category=category).aggregate(m=Max("position"))["m"] or 0
        obj = SystemEmoji.objects.create(emoji=emoji, file=att, shortcode=shortcode, category=category, position=max_pos + 1)
        return Response({
            "id": str(obj.id),
            "emoji": obj.emoji,
            "shortcode": obj.shortcode,
            "category": obj.category,
            "position": obj.position,
            "file": _file_to_dict(obj.file),
            "created_at": obj.created_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class SystemEmojiDetailView(APIView):
    """PATCH, DELETE: редактировать/удалить системный эмодзи (только staff)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, emoji_id):
        err = _require_staff(request)
        if err:
            return err
        obj = get_object_or_404(SystemEmoji, id=emoji_id)
        emoji = request.data.get("emoji")
        if emoji is not None:
            obj.emoji = str(emoji).strip()[:32]
        shortcode = request.data.get("shortcode")
        if shortcode is not None:
            obj.shortcode = str(shortcode).strip()[:64]
        category = request.data.get("category")
        if category is not None:
            obj.category = str(category).strip()[:64]
        position = request.data.get("position")
        if position is not None:
            obj.position = int(position) if position is not None else 0
        obj.save()
        return Response({
            "id": str(obj.id),
            "emoji": obj.emoji,
            "shortcode": obj.shortcode,
            "category": obj.category,
            "position": obj.position,
            "file": _file_to_dict(obj.file),
            "created_at": obj.created_at.isoformat(),
        })

    def delete(self, request, emoji_id):
        err = _require_staff(request)
        if err:
            return err
        obj = get_object_or_404(SystemEmoji, id=emoji_id)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- System Stickers ---


class SystemStickerListView(APIView):
    """GET: список системных стикеров (все пользователи). POST: добавить (только staff)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = SystemSticker.objects.select_related("file").order_by("position", "created_at")
        data = [
            {
                "id": str(item.id),
                "emoji": item.emoji or "",
                "label": item.label or "",
                "position": item.position,
                "file": _file_to_dict(item.file),
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ]
        return Response(data)

    def post(self, request):
        err = _require_staff(request)
        if err:
            return err
        file_id_raw = request.data.get("file_id")
        if not file_id_raw:
            return Response({"detail": "Укажите file_id (загруженный с storage_context=system_sticker)."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            file_id = uuid.UUID(str(file_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный file_id."}, status=status.HTTP_400_BAD_REQUEST)
        att = FileAttachment.objects.filter(id=file_id).first()
        if not att:
            return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        if not att.file_path.startswith("chat_uploads/system/stickers/"):
            return Response({"detail": "Файл должен быть загружен в системное хранилище стикеров."}, status=status.HTTP_400_BAD_REQUEST)
        mime = (att.mime_type or "").lower()
        allowed = mime.startswith("image/") or mime == "application/json"
        if not allowed:
            return Response({"detail": "Стикер должен быть изображением или Lottie JSON."}, status=status.HTTP_400_BAD_REQUEST)

        emoji = (request.data.get("emoji") or "").strip()[:16]
        label = (request.data.get("label") or "").strip()[:64]

        max_pos = SystemSticker.objects.aggregate(m=Max("position"))["m"] or 0
        obj = SystemSticker.objects.create(file=att, emoji=emoji, label=label, position=max_pos + 1)
        return Response({
            "id": str(obj.id),
            "emoji": obj.emoji,
            "label": obj.label,
            "position": obj.position,
            "file": _file_to_dict(obj.file),
            "created_at": obj.created_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class SystemStickerDetailView(APIView):
    """PATCH, DELETE: редактировать/удалить системный стикер (только staff)."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, sticker_id):
        err = _require_staff(request)
        if err:
            return err
        obj = get_object_or_404(SystemSticker, id=sticker_id)
        emoji = request.data.get("emoji")
        if emoji is not None:
            obj.emoji = str(emoji).strip()[:16]
        label = request.data.get("label")
        if label is not None:
            obj.label = str(label).strip()[:64]
        position = request.data.get("position")
        if position is not None:
            obj.position = int(position)
        obj.save()
        return Response({
            "id": str(obj.id),
            "emoji": obj.emoji,
            "label": obj.label,
            "position": obj.position,
            "file": _file_to_dict(obj.file),
            "created_at": obj.created_at.isoformat(),
        })

    def delete(self, request, sticker_id):
        err = _require_staff(request)
        if err:
            return err
        obj = get_object_or_404(SystemSticker, id=sticker_id)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
