import hashlib
import hmac
import mimetypes
from io import BytesIO
import os
import time
import uuid
from pathlib import Path
from uuid import UUID

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.chats.models import Chat, ChatMember
from apps.users.models import User, UserAvatar
from .models import FileAttachment
from .protected_media import verify_protected_media_token
from .serializers import FileAttachmentSerializer
from .tasks import scan_uploaded_file
from PIL import Image, ImageOps

MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 ГБ
FILE_TOKEN_TTL_SECONDS = 60 * 60
ALLOWED_UPLOAD_MIME_PREFIXES = (
    "image/",
    "audio/",
    "video/",
    "application/pdf",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
)
INLINE_BLOCKED_MIME_TYPES = {
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
}


def make_file_token(file_id: str, expires_at: int | None = None) -> str:
    """Generate HMAC token with embedded expiration timestamp."""
    if expires_at is None:
        expires_at = int(time.time()) + FILE_TOKEN_TTL_SECONDS
    payload = f"{file_id}:{expires_at}"
    key = settings.SECRET_KEY.encode()
    sig = hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()
    return f"{expires_at}.{sig}"


def verify_file_token(file_id: str, token: str) -> bool:
    try:
        expires_raw, sig = token.split(".", 1)
        expires_at = int(expires_raw)
    except (ValueError, TypeError):
        return False
    now_ts = int(time.time())
    if expires_at < now_ts:
        return False
    payload = f"{file_id}:{expires_at}"
    expected_sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_sig, sig)


class FileUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request):
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > MAX_FILE_SIZE:
            return Response({"detail": "Файл больше 2 ГБ."}, status=status.HTTP_400_BAD_REQUEST)

        is_encrypted = request.data.get("is_encrypted") in (True, "true", "1")
        clean_original_name = os.path.basename(file_obj.name or "file")
        guessed_mime = mimetypes.guess_type(clean_original_name)[0] or ""
        mime_type = guessed_mime or file_obj.content_type or "application/octet-stream"

        if is_encrypted:
            mime_type = "application/octet-stream"
        else:
            if mime_type == "image/svg+xml":
                return Response({"detail": "SVG-файлы запрещены из соображений безопасности."}, status=status.HTTP_400_BAD_REQUEST)
            if not any(
                mime_type.startswith(prefix) if prefix.endswith("/") else mime_type == prefix
                for prefix in ALLOWED_UPLOAD_MIME_PREFIXES
            ):
                return Response({"detail": "Неподдерживаемый тип файла."}, status=status.HTTP_400_BAD_REQUEST)
        chat_id_raw = request.data.get("chat_id")
        chat_id = None
        if chat_id_raw:
            try:
                chat_id = UUID(str(chat_id_raw))
            except (ValueError, TypeError):
                return Response({"detail": "Некорректный chat_id."}, status=status.HTTP_400_BAD_REQUEST)
            if not ChatMember.objects.filter(chat_id=chat_id, user=request.user, status=ChatMember.Status.ACTIVE).exists():
                return Response({"detail": "Нет доступа к чату."}, status=status.HTTP_403_FORBIDDEN)

        subdir = f"chat_{chat_id}" if chat_id else "uploads"
        rel_dir = os.path.join("chat_uploads", subdir)
        save_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
        os.makedirs(save_dir, exist_ok=True)
        ext = os.path.splitext(clean_original_name)[1] or ""
        new_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(rel_dir, new_name).replace("\\", "/")
        full_path = os.path.join(settings.MEDIA_ROOT, file_path)
        with open(full_path, "wb+") as dest:
            for chunk in file_obj.chunks():
                dest.write(chunk)
        scan_status = FileAttachment.ScanStatus.ENCRYPTED if is_encrypted else FileAttachment.ScanStatus.PENDING
        att = FileAttachment.objects.create(
            uploader=request.user,
            original_name=clean_original_name,
            file_path=file_path,
            mime_type=mime_type,
            size_bytes=file_obj.size,
            storage_type=FileAttachment.StorageType.LOCAL,
            scan_status=scan_status,
            is_encrypted=is_encrypted,
        )
        if not is_encrypted:
            try:
                scan_uploaded_file.delay(str(att.id))
            except Exception:
                pass
        return Response(FileAttachmentSerializer(att, context={"request": request}).data, status=status.HTTP_201_CREATED)


class SecureFileServeView(APIView):
    """Serve files securely — URL hides file name and requires HMAC token."""
    permission_classes = [AllowAny]  # Token-based auth, not JWT

    def get(self, request, file_id):
        token = request.query_params.get("t", "")
        if not token or not verify_file_token(str(file_id), token):
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        try:
            att = FileAttachment.objects.get(pk=file_id)
        except FileAttachment.DoesNotExist:
            raise Http404
        if att.scan_status == FileAttachment.ScanStatus.PENDING:
            return Response({"detail": "Файл проходит антивирусную проверку."}, status=status.HTTP_423_LOCKED)
        if att.scan_status in {FileAttachment.ScanStatus.INFECTED, FileAttachment.ScanStatus.ERROR}:
            return Response({"detail": "Доступ к файлу запрещён."}, status=status.HTTP_403_FORBIDDEN)

        is_encrypted = getattr(att, "is_encrypted", False) or att.scan_status == FileAttachment.ScanStatus.ENCRYPTED
        media_root = Path(settings.MEDIA_ROOT).resolve()
        full_path = (media_root / att.file_path).resolve()
        if media_root not in full_path.parents and full_path != media_root:
            raise Http404
        if not full_path.is_file():
            raise Http404
        content_type = "application/octet-stream" if is_encrypted else (att.mime_type or mimetypes.guess_type(att.original_name)[0] or "application/octet-stream")

        # Optional lightweight preview for images
        try:
            w_raw = request.query_params.get("w")
            h_raw = request.query_params.get("h")
            w = int(w_raw) if w_raw else 0
            h = int(h_raw) if h_raw else 0
        except (TypeError, ValueError):
            w, h = 0, 0

        if not is_encrypted and content_type.startswith("image/") and (w or h):
            w = max(16, min(2000, w or 0))
            h = max(16, min(2000, h or 0))
            with Image.open(full_path) as img:
                img = ImageOps.exif_transpose(img)
                if not w or not h:
                    # Preserve aspect ratio if only one side provided
                    if w and not h:
                        ratio = w / float(img.width)
                        h = max(16, int(img.height * ratio))
                    elif h and not w:
                        ratio = h / float(img.height)
                        w = max(16, int(img.width * ratio))
                img.thumbnail((w, h), Image.LANCZOS)
                buf = BytesIO()
                has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
                if has_alpha:
                    img.save(buf, format="PNG", optimize=True)
                    out_type = "image/png"
                else:
                    img = img.convert("RGB")
                    img.save(buf, format="WEBP", quality=92, method=6)
                    out_type = "image/webp"
                buf.seek(0)
                resp = HttpResponse(buf.read(), content_type=out_type)
                resp["Cache-Control"] = "private, max-age=3600"
                return resp

        response = FileResponse(open(full_path, "rb"), content_type=content_type)
        # Inline for images/audio/video, attachment for others
        if content_type.startswith(("image/", "audio/", "video/")) and content_type not in INLINE_BLOCKED_MIME_TYPES:
            response["Content-Disposition"] = f'inline; filename="{att.original_name}"'
        else:
            response["Content-Disposition"] = f'attachment; filename="{att.original_name}"'
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response


# ─── Protected media (avatars, chat avatars, backgrounds) ─────────────────────
# Только для авторизованных, с проверкой доступа. URL с HMAC-токеном — перебор невозможен.

ALLOWED_MEDIA_PREFIXES = ("avatars/", "user_avatars/", "chat_avatars/", "chat_backgrounds/")


def _user_has_access_to_user_avatar(requester: User, owner: User) -> bool:
    """Доступ: владелец или общий чат."""
    if requester.id == owner.id:
        return True
    # Есть общий активный чат (личный или группа)
    owner_chat_ids = ChatMember.objects.filter(
        user=owner,
        status=ChatMember.Status.ACTIVE,
    ).values_list("chat_id", flat=True)
    return ChatMember.objects.filter(
        user=requester,
        status=ChatMember.Status.ACTIVE,
        chat_id__in=owner_chat_ids,
    ).exists()


def _user_has_access_to_chat_media(requester: User, chat: Chat) -> bool:
    """Доступ: участник чата."""
    return ChatMember.objects.filter(
        chat=chat,
        user=requester,
        status=ChatMember.Status.ACTIVE,
    ).exists()


class ProtectedMediaServeView(APIView):
    """Раздача аватарок и медиа чатов. Требует авторизацию и проверку доступа."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from urllib.parse import unquote

        path_raw = request.query_params.get("path", "")
        token = request.query_params.get("t", "")
        path = unquote(path_raw).strip().replace("\\", "/").lstrip("/")

        if not path or not token:
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        if not any(path.startswith(p) for p in ALLOWED_MEDIA_PREFIXES):
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        if ".." in path or path.startswith("/"):
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)

        if not verify_protected_media_token(path, token):
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)

        media_root = Path(settings.MEDIA_ROOT).resolve()
        full_path = (media_root / path).resolve()
        if media_root not in full_path.parents and full_path != media_root:
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        if not full_path.is_file():
            raise Http404

        # Проверка доступа по типу пути
        if path.startswith("avatars/"):
            user = User.objects.filter(avatar=path).first()
            if not user or not _user_has_access_to_user_avatar(request.user, user):
                return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        elif path.startswith("user_avatars/"):
            ua = UserAvatar.objects.filter(image=path).select_related("user").first()
            if not ua or not _user_has_access_to_user_avatar(request.user, ua.user):
                return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        elif path.startswith("chat_avatars/"):
            chat = Chat.objects.filter(avatar=path).first()
            if not chat or not _user_has_access_to_chat_media(request.user, chat):
                return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        elif path.startswith("chat_backgrounds/"):
            chat = Chat.objects.filter(background=path).first()
            if not chat or not _user_has_access_to_chat_media(request.user, chat):
                return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)
        else:
            return Response({"detail": "Доступ запрещён."}, status=status.HTTP_403_FORBIDDEN)

        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        response = FileResponse(open(full_path, "rb"), content_type=content_type)
        response["Content-Disposition"] = "inline"
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response
