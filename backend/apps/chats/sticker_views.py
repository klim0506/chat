"""Sticker packs API — create packs, add stickers, install, recent (Telegram-style)."""
import re
import uuid
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.files.models import FileAttachment
from apps.files.views import make_file_token

from .models import RECENT_STICKERS_LIMIT, Sticker, StickerSet, UserStickerSet, RecentSticker
from apps.payments.plan_limits import can_create_custom_stickers, RESTRICTION_CODE

SHORT_NAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")


def _file_dict(att, request=None):
    """Build file dict with url for sticker display."""
    if not att:
        return None
    token = make_file_token(str(att.id))
    path = f"/api/files/{att.id}/?t={token}"
    url = request.build_absolute_uri(path) if request else path
    return {
        "id": str(att.id),
        "url": url,
        "mime_type": att.mime_type,
        "original_name": att.original_name,
    }


def _sticker_to_dict(sticker, request=None):
    """Serialize sticker for API response."""
    file_data = _file_dict(sticker.file, request) if sticker.file else None
    return {
        "id": str(sticker.id),
        "pack_id": str(sticker.pack_id),
        "file_id": str(sticker.file_id) if sticker.file_id else None,
        "file": file_data,
        "emoji": sticker.emoji or "",
        "label": sticker.label or "",
        "position": sticker.position,
        "created_at": sticker.created_at.isoformat(),
    }


def _stickerset_to_dict(pack, stickers=None, request=None):
    """Serialize sticker set with optional stickers list."""
    data = {
        "id": str(pack.id),
        "title": pack.title,
        "short_name": pack.short_name,
        "owner_id": str(pack.owner_id),
        "created_at": pack.created_at.isoformat(),
    }
    if stickers is not None:
        data["stickers"] = [_sticker_to_dict(s, request) for s in stickers]
    return data


class StickerPackListCreateView(APIView):
    """GET: list packs owned by current user. POST: create pack."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        packs = StickerSet.objects.filter(owner=request.user).order_by("created_at")
        return Response([_stickerset_to_dict(p, request=request) for p in packs])

    def post(self, request):
        if not can_create_custom_stickers(request.user):
            return Response(
                {"detail": "Создание своих наборов стикеров доступно по подписке. Оформите подписку в настройках.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )
        title = (request.data.get("title") or "").strip()
        short_name = (request.data.get("short_name") or "").strip().lower()
        if not title:
            return Response({"detail": "Укажите title."}, status=status.HTTP_400_BAD_REQUEST)
        if not short_name:
            return Response({"detail": "Укажите short_name."}, status=status.HTTP_400_BAD_REQUEST)
        if not SHORT_NAME_PATTERN.match(short_name):
            return Response(
                {"detail": "short_name: 3–32 символа, только a-z, 0-9, _."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if StickerSet.objects.filter(owner=request.user, short_name=short_name).exists():
            return Response(
                {"detail": "Пак с таким short_name уже существует."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pack = StickerSet.objects.create(owner=request.user, title=title, short_name=short_name)
        return Response(_stickerset_to_dict(pack, request=request), status=status.HTTP_201_CREATED)


class StickerPackDetailView(APIView):
    """GET, PATCH, DELETE: pack owned by current user."""

    permission_classes = [IsAuthenticated]

    def _get_pack(self, request, pack_id):
        return get_object_or_404(StickerSet, id=pack_id, owner=request.user)

    def get(self, request, pack_id):
        pack = self._get_pack(request, pack_id)
        stickers = list(pack.stickers.all())
        return Response(_stickerset_to_dict(pack, stickers=stickers, request=request))

    def patch(self, request, pack_id):
        pack = self._get_pack(request, pack_id)
        title = request.data.get("title")
        if title is not None:
            title = str(title).strip()
            if title:
                pack.title = title
                pack.save(update_fields=["title"])
        return Response(_stickerset_to_dict(pack, request=request))

    def delete(self, request, pack_id):
        pack = self._get_pack(request, pack_id)
        pack.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StickerListCreateView(APIView):
    """GET: list stickers in pack. POST: add sticker (file_id, emoji, label)."""

    permission_classes = [IsAuthenticated]

    def _get_pack(self, request, pack_id):
        return get_object_or_404(StickerSet, id=pack_id, owner=request.user)

    def get(self, request, pack_id):
        pack = self._get_pack(request, pack_id)
        stickers = list(pack.stickers.all().select_related("file"))
        return Response([_sticker_to_dict(s, request) for s in stickers])

    def post(self, request, pack_id):
        pack = self._get_pack(request, pack_id)
        file_id_raw = request.data.get("file_id")
        if not file_id_raw:
            return Response({"detail": "Укажите file_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            file_id = uuid.UUID(str(file_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный file_id."}, status=status.HTTP_400_BAD_REQUEST)

        att = FileAttachment.objects.filter(id=file_id, uploader=request.user).first()
        if not att:
            return Response({"detail": "Файл не найден или не принадлежит вам."}, status=status.HTTP_404_NOT_FOUND)

        mime = (att.mime_type or "").lower()
        allowed = mime.startswith("image/") or mime == "application/json"
        if not allowed:
            return Response(
                {"detail": "Для стикеров допустимы только изображения (ICO, JPEG, PNG, WebP и др.) или Lottie JSON."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        emoji = (request.data.get("emoji") or "").strip()[:16]
        label = (request.data.get("label") or "").strip()[:64]

        max_pos = pack.stickers.aggregate(m=Max("position"))["m"] or 0
        sticker = Sticker.objects.create(
            pack=pack,
            file=att,
            emoji=emoji,
            label=label,
            position=max_pos + 1,
        )
        return Response(_sticker_to_dict(sticker, request), status=status.HTTP_201_CREATED)


class StickerDetailView(APIView):
    """DELETE: remove sticker from pack."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pack_id, sticker_id):
        pack = get_object_or_404(StickerSet, id=pack_id, owner=request.user)
        sticker = get_object_or_404(Sticker, id=sticker_id, pack=pack)
        sticker.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstalledStickerSetsView(APIView):
    """GET: list installed sticker sets (UserStickerSet) with preview stickers."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        installs = (
            UserStickerSet.objects.filter(user=request.user)
            .select_related("stickerset")
            .prefetch_related("stickerset__stickers__file")
            .order_by("order", "installed_at")
        )
        result = []
        for inst in installs:
            pack = inst.stickerset
            stickers = list(pack.stickers.all()[:12])  # preview: first 12
            result.append({
                **dict(_stickerset_to_dict(pack, stickers=stickers, request=request)),
                "order": inst.order,
                "installed_at": inst.installed_at.isoformat(),
            })
        return Response(result)


class InstallStickerSetView(APIView):
    """POST: install a sticker set (add to UserStickerSet)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        stickerset_id = request.data.get("stickerset_id")
        if not stickerset_id:
            return Response({"detail": "Укажите stickerset_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            pack_id = uuid.UUID(str(stickerset_id))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный stickerset_id."}, status=status.HTTP_400_BAD_REQUEST)

        pack = StickerSet.objects.filter(id=pack_id).first()
        if not pack:
            return Response({"detail": "Набор стикеров не найден."}, status=status.HTTP_404_NOT_FOUND)

        if UserStickerSet.objects.filter(user=request.user, stickerset=pack).exists():
            return Response(_stickerset_to_dict(pack, request=request))

        max_order = (
            UserStickerSet.objects.filter(user=request.user).aggregate(m=Max("order"))["m"] or 0
        )
        UserStickerSet.objects.create(user=request.user, stickerset=pack, order=max_order + 1)
        return Response(_stickerset_to_dict(pack, request=request))


class UninstallStickerSetView(APIView):
    """POST: uninstall a sticker set."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        stickerset_id = request.data.get("stickerset_id")
        if not stickerset_id:
            return Response({"detail": "Укажите stickerset_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            pack_id = uuid.UUID(str(stickerset_id))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный stickerset_id."}, status=status.HTTP_400_BAD_REQUEST)

        deleted, _ = UserStickerSet.objects.filter(
            user=request.user, stickerset_id=pack_id
        ).delete()
        return Response({"uninstalled": deleted > 0})


class RecentStickersView(APIView):
    """GET: list recent stickers for current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        recents = (
            RecentSticker.objects.filter(user=request.user)
            .select_related("sticker", "sticker__file", "sticker__pack")
            .order_by("-used_at")[:RECENT_STICKERS_LIMIT]
        )
        stickers = [r.sticker for r in recents]
        return Response([_sticker_to_dict(s, request) for s in stickers])


class SaveRecentStickerView(APIView):
    """POST: save sticker to recent list (called when user sends a sticker)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        sticker_id = request.data.get("sticker_id")
        if not sticker_id:
            return Response({"detail": "Укажите sticker_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            sid = uuid.UUID(str(sticker_id))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный sticker_id."}, status=status.HTTP_400_BAD_REQUEST)

        sticker = Sticker.objects.filter(id=sid).first()
        if not sticker:
            return Response({"detail": "Стикер не найден."}, status=status.HTTP_404_NOT_FOUND)

        recent, created = RecentSticker.objects.get_or_create(
            user=request.user, sticker=sticker, defaults={"used_at": timezone.now()}
        )
        if not created:
            recent.used_at = timezone.now()
            recent.save(update_fields=["used_at"])

        total = RecentSticker.objects.filter(user=request.user).count()
        if total > RECENT_STICKERS_LIMIT:
            to_remove = list(
                RecentSticker.objects.filter(user=request.user).order_by("used_at")[
                    : total - RECENT_STICKERS_LIMIT
                ].values_list("id", flat=True)
            )
            RecentSticker.objects.filter(id__in=to_remove).delete()

        return Response({"ok": True})
