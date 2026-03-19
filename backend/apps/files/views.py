import hashlib
import hmac
import logging
import mimetypes
import re
from datetime import timezone as dt_timezone
from io import BytesIO
from urllib.parse import quote
import os
import time
import uuid
from pathlib import Path
from uuid import UUID

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.chats.models import ChatMember
from apps.payments.plan_limits import get_max_file_size_bytes, get_max_daily_file_uploads, RESTRICTION_CODE
from .access_handles import (
    KIND_CHANNEL_AVATAR,
    KIND_CHAT_AVATAR,
    KIND_CHAT_BACKGROUND,
    KIND_FILE,
    KIND_USER_AVATAR,
    KIND_USER_GALLERY_AVATAR,
    parse_media_handle,
)
from .models import ChunkedUploadSession, FileAttachment
from .protected_media import make_protected_media_url, verify_protected_media_token
from .serializers import FileAttachmentSerializer
from .tasks import optimize_uploaded_image
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB fallback
FILE_TOKEN_TTL_SECONDS = 24 * 60 * 60  # 24h — reduce 403 for cached/long-open tabs
# Chunked upload: 128 KB per part — server only holds one part in memory
CHUNKED_UPLOAD_PART_SIZE = 128 * 1024
ALLOWED_UPLOAD_MIME_PREFIXES = (
    "image/",
    "audio/",
    "video/",
    "application/pdf",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
    "application/json",  # Lottie animations for stickers
    # Microsoft Office
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    # OpenDocument (LibreOffice)
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    # Text formats
    "text/csv",
    "text/markdown",
    "application/rtf",
    # Archives
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-bzip2",
    "application/x-xz",
    # E-books
    "application/epub+zip",
    # Apple iWork
    "application/vnd.apple.pages",
    "application/vnd.apple.numbers",
    "application/vnd.apple.keynote",
    # Visio
    "application/vnd.visio",
    # Fonts
    "font/ttf",
    "font/otf",
    "font/woff",
    "font/woff2",
    # Code and config (text-based, safe)
    "text/javascript",
    "application/javascript",
    "text/x-typescript",
    "application/typescript",
    "text/x-python",
    "text/yaml",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/x-sh",
    "text/x-c",
    "text/x-c++",
    "text/x-java",
    "application/x-php",
    "text/x-ruby",
    "text/x-go",
    "application/x-rust",
    "text/x-sql",
    "text/x-vue",
    "text/x-scala",
    "application/x-msdownload",  # .dll
    "application/x-executable",
    # 3D models
    "model/",
    "application/sla",
    "application/vnd.ms-pki.stl",
    "application/x-navistep",
    "application/step",
    # Чертежи и CAD (часто приходят как octet-stream — см. ALLOWED_OCTET_STREAM_EXTENSIONS)
    "application/dxf",
    "application/acad",
    "application/x-dwg",
    "application/vnd.ms-pki.dwg",
)
# Расширения, допустимые при MIME application/octet-stream (3D, CAD и т.п.)
ALLOWED_OCTET_STREAM_EXTENSIONS = frozenset(
    ext.lower()
    for ext in (
        ".stl", ".obj", ".blend", ".fbx", ".glb", ".gltf", ".3ds", ".dae", ".x3d", ".wrl", ".ply", ".off",
        ".dwg", ".dxf", ".step", ".stp", ".iges", ".igs", ".ifc", ".rvt", ".skp",
        ".py", ".pyw", ".js", ".jsx", ".ts", ".tsx", ".vue", ".go", ".rs", ".java", ".kt", ".kts",
        ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".cs", ".rb", ".php", ".sql", ".sh", ".bash", ".zsh",
        ".r", ".swift", ".m", ".mm", ".scala", ".sbt", ".gradle", ".env", ".dockerfile",
        ".lock", ".sum", ".mod", ".toml", ".yaml", ".yml", ".json", ".xml", ".proto",
    )
)
INLINE_BLOCKED_MIME_TYPES = {
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
}


def _safe_content_disposition_filename(name: str, max_length: int = 200) -> str:
    """Sanitize filename for Content-Disposition to prevent header injection (CRLF, quotes)."""
    if not name or not isinstance(name, str):
        return "download"
    # Remove control chars, quotes, backslash, newlines
    safe = re.sub(r'[\x00-\x1f\x7f"\\\r\n]', "", name)
    safe = safe.strip() or "download"
    if len(safe) > max_length:
        ext = os.path.splitext(safe)[1]
        safe = safe[: max_length - len(ext)] + ext
    return safe


def _content_disposition_value(disposition: str, filename: str) -> str:
    """Build Content-Disposition value with safe filename; use RFC 5987 for non-ASCII."""
    safe = _safe_content_disposition_filename(filename)
    # ASCII-only filename= for legacy clients
    ascii_name = safe.encode("ascii", "replace").decode("ascii").replace("?", "_")
    if not ascii_name:
        ascii_name = "download"
    value = f'{disposition}; filename="{ascii_name}"'
    if safe != ascii_name:
        value += f"; filename*=UTF-8''{quote(safe, safe='')}"
    return value


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


def _signed_file_url(request, att: FileAttachment, *, expires_at: int) -> str:
    token = make_file_token(str(att.id), expires_at=expires_at)
    path = f"/api/files/{att.id}/?t={token}"
    return request.build_absolute_uri(path) if request else path


def _chat_access_q(user) -> Q:
    return Q(chat__members__user=user, chat__members__status=ChatMember.Status.ACTIVE)


def _channel_access_q(user) -> Q:
    from apps.chats.models import ChannelMember

    return Q(channel__is_public=True) | Q(channel__members__user=user, channel__members__status=ChannelMember.Status.ACTIVE)


def _user_can_access_file(user, att: FileAttachment) -> bool:
    from apps.chats.models import ChannelPost, ChannelPostComment, Message, Sticker

    if att.external_url:
        return True
    if att.uploader_id == user.id:
        return True
    file_q = Q(file=att) | Q(files=att)
    if Message.objects.filter(file_q).filter(_chat_access_q(user)).exists():
        return True
    if ChannelPost.objects.filter(file_q, is_deleted=False).filter(_channel_access_q(user)).exists():
        return True
    comment_access = Q(post__channel__is_public=True) | Q(
        post__channel__members__user=user,
        post__channel__members__status="active",
    )
    if ChannelPostComment.objects.filter(file_q, is_deleted=False).filter(comment_access).exists():
        return True
    if Sticker.objects.filter(file=att).filter(Q(pack__owner=user) | Q(pack__installed_by__user=user)).exists():
        return True
    return False


def _user_can_access_chat_media(user, chat_id: str) -> bool:
    return ChatMember.objects.filter(chat_id=chat_id, user=user, status=ChatMember.Status.ACTIVE).exists()


def _user_can_access_channel_media(user, channel) -> bool:
    from apps.chats.models import ChannelMember

    if getattr(channel, "is_public", False):
        return True
    return ChannelMember.objects.filter(channel=channel, user=user, status=ChannelMember.Status.ACTIVE).exists()


class MediaAccessView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        handle = str(request.query_params.get("handle") or "").strip()
        if not handle:
            return Response({"detail": "Media handle is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = parse_media_handle(handle)
        except Exception:
            return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)

        kind = payload["kind"]
        object_id = payload["object_id"]
        variant = payload["variant"] or "original"
        expires_at = int(time.time()) + 15 * 60

        if kind == KIND_FILE:
            try:
                att = FileAttachment.objects.get(pk=object_id)
            except FileAttachment.DoesNotExist:
                raise Http404
            if not _user_can_access_file(request.user, att):
                return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)
            url = att.external_url or _signed_file_url(request, att, expires_at=expires_at)
            target_id = str(att.id)
        elif kind == KIND_USER_AVATAR:
            from apps.users.models import User

            try:
                user = User.objects.get(pk=object_id)
            except User.DoesNotExist:
                raise Http404
            path = user._get_avatar_path()
            if not path:
                raise Http404
            url = make_protected_media_url(path, request, size=variant, expires_at=expires_at)
            target_id = str(user.id)
        elif kind == KIND_USER_GALLERY_AVATAR:
            from apps.users.models import UserAvatar

            try:
                avatar = UserAvatar.objects.select_related("user").get(pk=object_id)
            except UserAvatar.DoesNotExist:
                raise Http404
            url = make_protected_media_url(avatar.image.name, request, size=variant, expires_at=expires_at)
            target_id = str(avatar.id)
        elif kind == KIND_CHAT_AVATAR:
            from apps.chats.models import Chat

            try:
                chat = Chat.objects.get(pk=object_id, is_active=True)
            except Chat.DoesNotExist:
                raise Http404
            if not chat.avatar or not _user_can_access_chat_media(request.user, str(chat.id)):
                return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)
            url = make_protected_media_url(chat.avatar.name, request, size=variant, expires_at=expires_at)
            target_id = str(chat.id)
        elif kind == KIND_CHAT_BACKGROUND:
            from apps.chats.models import Chat

            try:
                chat = Chat.objects.get(pk=object_id, is_active=True)
            except Chat.DoesNotExist:
                raise Http404
            if not chat.background or not _user_can_access_chat_media(request.user, str(chat.id)):
                return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)
            url = make_protected_media_url(chat.background.name, request, expires_at=expires_at)
            target_id = str(chat.id)
        elif kind == KIND_CHANNEL_AVATAR:
            from apps.chats.models import Channel

            try:
                channel = Channel.objects.get(pk=object_id, is_active=True)
            except Channel.DoesNotExist:
                raise Http404
            if not channel.avatar or not _user_can_access_channel_media(request.user, channel):
                return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)
            url = make_protected_media_url(channel.avatar.name, request, size=variant, expires_at=expires_at)
            target_id = str(channel.id)
        else:
            return Response({"detail": "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ."}, status=status.HTTP_403_FORBIDDEN)

        if not url:
            raise Http404

        expires_at_iso = timezone.datetime.fromtimestamp(expires_at, tz=dt_timezone.utc).isoformat()
        logger.info(
            "media_access_granted user_id=%s kind=%s target_id=%s expires_at=%s",
            request.user.id,
            kind,
            target_id,
            expires_at_iso,
        )
        return Response({"url": url, "expires_at": expires_at_iso})


class FileUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # #region agent log
        try:
            _log = {"sessionId": "5254ee", "hypothesisId": "H1", "location": "files/views.py:FileUploadView.post", "message": "upload_view_entered", "data": {"content_length": request.META.get("CONTENT_LENGTH")}, "timestamp": __import__("time", fromlist=["time"]).time() * 1000}
            open("/tmp/debug-5254ee.log", "a").write(__import__("json", fromlist=["dumps"]).dumps(_log) + "\n")
        except Exception:
            pass
        # #endregion
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        max_size = get_max_file_size_bytes(request.user)
        if file_obj.size > max_size:
            limit_mb = max_size // (1024 * 1024)
            return Response(
                {"detail": f"Лимит размера файла для вашего тарифа — {limit_mb} МБ. Оформите подписку для загрузки до 4 ГБ.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )

        max_daily = get_max_daily_file_uploads(request.user)
        if max_daily is not None:
            today = timezone.now().date()
            today_count = FileAttachment.objects.filter(
                uploader=request.user,
                created_at__date=today,
            ).count()
            if today_count >= max_daily:
                return Response(
                    {
                        "detail": f"Лимит загрузок файлов в день для вашего тарифа — {max_daily}. Оформите подписку для безлимитной загрузки.",
                        "code": RESTRICTION_CODE,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        is_encrypted = request.data.get("is_encrypted") in (True, "true", "1")
        clean_original_name = os.path.basename(file_obj.name or "file")
        guessed_mime = mimetypes.guess_type(clean_original_name)[0] or ""
        mime_type = guessed_mime or file_obj.content_type or "application/octet-stream"

        if is_encrypted:
            mime_type = "application/octet-stream"
        else:
            if mime_type == "image/svg+xml":
                return Response({"detail": "SVG-файлы запрещены из соображений безопасности."}, status=status.HTTP_400_BAD_REQUEST)
            allowed = any(
                mime_type.startswith(prefix) if prefix.endswith("/") else mime_type == prefix
                for prefix in ALLOWED_UPLOAD_MIME_PREFIXES
            )
            if not allowed and mime_type == "application/octet-stream":
                ext = os.path.splitext(clean_original_name)[1].lower()
                if ext in ALLOWED_OCTET_STREAM_EXTENSIONS:
                    allowed = True
            if not allowed:
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

        try:
            subdir = f"chat_{chat_id}" if chat_id else "uploads"
            rel_dir = os.path.join("chat_uploads", subdir)
            save_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
            os.makedirs(save_dir, exist_ok=True)
            ext = os.path.splitext(clean_original_name)[1] or ""
            new_name = f"{uuid.uuid4().hex}{ext}"
            file_path = os.path.join(rel_dir, new_name).replace("\\", "/")
            full_path = os.path.join(settings.MEDIA_ROOT, file_path)
            # #region agent log
            try:
                _log = {"sessionId": "5254ee", "hypothesisId": "H2", "location": "files/views.py:FileUploadView.post", "message": "upload_before_chunks", "data": {"size": file_obj.size}, "timestamp": __import__("time", fromlist=["time"]).time() * 1000}
                open("/tmp/debug-5254ee.log", "a").write(__import__("json", fromlist=["dumps"]).dumps(_log) + "\n")
            except Exception:
                pass
            # #endregion
            with open(full_path, "wb+") as dest:
                for chunk in file_obj.chunks():
                    dest.write(chunk)
            # #region agent log
            try:
                _log = {"sessionId": "5254ee", "hypothesisId": "H2", "location": "files/views.py:FileUploadView.post", "message": "upload_after_chunks", "data": {}, "timestamp": __import__("time", fromlist=["time"]).time() * 1000}
                open("/tmp/debug-5254ee.log", "a").write(__import__("json", fromlist=["dumps"]).dumps(_log) + "\n")
            except Exception:
                pass
            # #endregion
            scan_status = FileAttachment.ScanStatus.ENCRYPTED if is_encrypted else FileAttachment.ScanStatus.CLEAN
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
            if not is_encrypted and mime_type and mime_type.startswith("image/"):
                # Skip PIL for very large images to avoid OOM (PIL can decode full image)
                if file_obj.size <= 50 * 1024 * 1024:  # 50 MB
                    try:
                        with Image.open(full_path) as img:
                            img = ImageOps.exif_transpose(img)
                            att.width_px = img.width
                            att.height_px = img.height
                            att.save(update_fields=("width_px", "height_px"))
                    except Exception:
                        pass
                try:
                    optimize_uploaded_image.delay(str(att.id))
                except Exception:
                    pass
            # #region agent log
            try:
                _log = {"sessionId": "5254ee", "hypothesisId": "H4", "location": "files/views.py:FileUploadView.post", "message": "upload_success", "data": {"att_id": str(att.id)}, "timestamp": __import__("time", fromlist=["time"]).time() * 1000}
                open("/tmp/debug-5254ee.log", "a").write(__import__("json", fromlist=["dumps"]).dumps(_log) + "\n")
            except Exception:
                pass
            # #endregion
            return Response(FileAttachmentSerializer(att, context={"request": request}).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            # #region agent log
            try:
                _log = {"sessionId": "5254ee", "hypothesisId": "H4", "location": "files/views.py:FileUploadView.post", "message": "upload_exception", "data": {"error": str(e), "type": type(e).__name__}, "timestamp": __import__("time", fromlist=["time"]).time() * 1000}
                open("/tmp/debug-5254ee.log", "a").write(__import__("json", fromlist=["dumps"]).dumps(_log) + "\n")
            except Exception:
                pass
            # #endregion
            raise


def _delete_chunked_session_and_files(session: "ChunkedUploadSession") -> None:
    """Remove session's temp dir and delete session. Frees disk space on cancel or cleanup."""
    try:
        full_dir = os.path.join(settings.MEDIA_ROOT, session.temp_dir)
        if os.path.isdir(full_dir):
            for f in os.listdir(full_dir):
                os.unlink(os.path.join(full_dir, f))
            os.rmdir(full_dir)
    except OSError:
        pass
    session.delete()


def _clean_old_chunked_sessions():
    """Remove chunked upload sessions older than 2 hours and their temp dirs."""
    from django.utils import timezone
    from datetime import timedelta
    cutoff = timezone.now() - timedelta(hours=2)
    for session in ChunkedUploadSession.objects.filter(created_at__lt=cutoff):
        _delete_chunked_session_and_files(session)


class ChunkedUploadView(APIView):
    """
    Telegram-style chunked upload: client sends parts (e.g. 512 KB each).
    Server writes each part to disk and never holds the full file in RAM.
    """
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request):
        upload_id_raw = request.data.get("upload_id")
        part_raw = request.data.get("part")
        total_parts_raw = request.data.get("total_parts")
        file_obj = request.FILES.get("file")
        if not file_obj or part_raw is None or total_parts_raw is None:
            return Response(
                {"detail": "Нужны file, part и total_parts."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            part = int(part_raw)
            total_parts = int(total_parts_raw)
        except (TypeError, ValueError):
            return Response({"detail": "part и total_parts должны быть числами."}, status=status.HTTP_400_BAD_REQUEST)
        if total_parts < 1 or part < 0 or part >= total_parts:
            return Response({"detail": "Некорректный part или total_parts."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > CHUNKED_UPLOAD_PART_SIZE:
            return Response(
                {"detail": f"Размер части не должен превышать {CHUNKED_UPLOAD_PART_SIZE // 1024} КБ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not upload_id_raw:
            # First request: part must be 0, create session
            if part != 0:
                return Response({"detail": "Первый запрос должен быть с part=0."}, status=status.HTTP_400_BAD_REQUEST)
            filename = (request.data.get("filename") or file_obj.name or "file").strip() or "file"
            clean_original_name = os.path.basename(filename)
            chat_id = None
            chat_id_raw = request.data.get("chat_id")
            if chat_id_raw:
                try:
                    chat_id = UUID(str(chat_id_raw))
                except (ValueError, TypeError):
                    return Response({"detail": "Некорректный chat_id."}, status=status.HTTP_400_BAD_REQUEST)
                if not ChatMember.objects.filter(chat_id=chat_id, user=request.user, status=ChatMember.Status.ACTIVE).exists():
                    return Response({"detail": "Нет доступа к чату."}, status=status.HTTP_403_FORBIDDEN)
            is_encrypted = request.data.get("is_encrypted") in (True, "true", "1")
            mime_type = request.data.get("mime_type") or mimetypes.guess_type(clean_original_name)[0] or "application/octet-stream"
            if not is_encrypted:
                if mime_type == "image/svg+xml":
                    return Response({"detail": "SVG-файлы запрещены."}, status=status.HTTP_400_BAD_REQUEST)
                allowed = any(
                    mime_type.startswith(p) if p.endswith("/") else mime_type == p
                    for p in ALLOWED_UPLOAD_MIME_PREFIXES
                )
                if not allowed and mime_type == "application/octet-stream":
                    ext = os.path.splitext(clean_original_name)[1].lower()
                    if ext in ALLOWED_OCTET_STREAM_EXTENSIONS:
                        allowed = True
                if not allowed:
                    return Response({"detail": "Неподдерживаемый тип файла."}, status=status.HTTP_400_BAD_REQUEST)

            max_size = get_max_file_size_bytes(request.user)
            if total_parts * CHUNKED_UPLOAD_PART_SIZE > max_size:
                limit_mb = max_size // (1024 * 1024)
                return Response(
                    {"detail": f"Лимит размера файла — {limit_mb} МБ.", "code": RESTRICTION_CODE},
                    status=status.HTTP_403_FORBIDDEN,
                )
            max_daily = get_max_daily_file_uploads(request.user)
            if max_daily is not None:
                today = timezone.now().date()
                if FileAttachment.objects.filter(uploader=request.user, created_at__date=today).count() >= max_daily:
                    return Response(
                        {"detail": "Дневной лимит загрузок исчерпан.", "code": RESTRICTION_CODE},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            _clean_old_chunked_sessions()
            session_id = uuid.uuid4()
            rel_temp_dir = os.path.join("tmp_chunked_uploads", str(session_id))
            full_temp_dir = os.path.join(settings.MEDIA_ROOT, rel_temp_dir)
            os.makedirs(full_temp_dir, exist_ok=True)
            part_path = os.path.join(full_temp_dir, f"part_{part}")
            with open(part_path, "wb") as f:
                for chunk in file_obj.chunks():
                    f.write(chunk)
            session = ChunkedUploadSession.objects.create(
                id=session_id,
                user=request.user,
                temp_dir=rel_temp_dir,
                original_name=clean_original_name,
                mime_type=mime_type,
                total_parts=total_parts,
                chat_id=chat_id,
                is_encrypted=is_encrypted,
            )
            if total_parts == 1:
                full_temp_dir = os.path.join(settings.MEDIA_ROOT, session.temp_dir)
                try:
                    subdir = f"chat_{session.chat_id}" if session.chat_id else "uploads"
                    rel_dir = os.path.join("chat_uploads", subdir)
                    save_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
                    os.makedirs(save_dir, exist_ok=True)
                    ext = os.path.splitext(session.original_name)[1] or ""
                    new_name = f"{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(rel_dir, new_name).replace("\\", "/")
                    full_path = os.path.join(settings.MEDIA_ROOT, file_path)
                    total_size = 0
                    with open(full_path, "wb") as out:
                        with open(os.path.join(full_temp_dir, "part_0"), "rb") as inp:
                            data = inp.read()
                            total_size = len(data)
                            out.write(data)
                    os.unlink(os.path.join(full_temp_dir, "part_0"))
                    os.rmdir(full_temp_dir)
                    orig_name = session.original_name
                    mime = session.mime_type
                    is_enc = session.is_encrypted
                    scan_status = FileAttachment.ScanStatus.ENCRYPTED if is_enc else FileAttachment.ScanStatus.CLEAN
                    att = FileAttachment.objects.create(
                        uploader=request.user,
                        original_name=orig_name,
                        file_path=file_path,
                        mime_type=mime,
                        size_bytes=total_size,
                        storage_type=FileAttachment.StorageType.LOCAL,
                        scan_status=scan_status,
                        is_encrypted=is_enc,
                    )
                    if not is_enc and mime and mime.startswith("image/") and total_size <= 50 * 1024 * 1024:
                        try:
                            with Image.open(full_path) as img:
                                img = ImageOps.exif_transpose(img)
                                att.width_px = img.width
                                att.height_px = img.height
                                att.save(update_fields=("width_px", "height_px"))
                        except Exception:
                            pass
                        try:
                            optimize_uploaded_image.delay(str(att.id))
                        except Exception:
                            pass
                    session.delete()
                    return Response(FileAttachmentSerializer(att, context={"request": request}).data, status=status.HTTP_201_CREATED)
                except Exception as e:
                    if os.path.isdir(full_temp_dir):
                        try:
                            for f in os.listdir(full_temp_dir):
                                os.unlink(os.path.join(full_temp_dir, f))
                            os.rmdir(full_temp_dir)
                        except OSError:
                            pass
                    session.delete()
                    return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response({"upload_id": str(session_id)}, status=status.HTTP_200_OK)

        # Subsequent request: must have existing session
        try:
            session_id = UUID(str(upload_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный upload_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            session = ChunkedUploadSession.objects.get(pk=session_id, user=request.user)
        except ChunkedUploadSession.DoesNotExist:
            return Response({"detail": "Сессия загрузки не найдена или истекла."}, status=status.HTTP_404_NOT_FOUND)
        if total_parts != session.total_parts:
            return Response({"detail": "total_parts не совпадает с сессией."}, status=status.HTTP_400_BAD_REQUEST)
        full_temp_dir = os.path.join(settings.MEDIA_ROOT, session.temp_dir)
        if not os.path.isdir(full_temp_dir):
            session.delete()
            return Response({"detail": "Сессия загрузки повреждена."}, status=status.HTTP_410_GONE)
        part_path = os.path.join(full_temp_dir, f"part_{part}")
        with open(part_path, "wb") as f:
            for chunk in file_obj.chunks():
                f.write(chunk)

        if part != session.total_parts - 1:
            return Response({"upload_id": str(session_id)}, status=status.HTTP_200_OK)

        # Last part: concatenate, create FileAttachment, cleanup
        try:
            subdir = f"chat_{session.chat_id}" if session.chat_id else "uploads"
            rel_dir = os.path.join("chat_uploads", subdir)
            save_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
            os.makedirs(save_dir, exist_ok=True)
            ext = os.path.splitext(session.original_name)[1] or ""
            new_name = f"{uuid.uuid4().hex}{ext}"
            file_path = os.path.join(rel_dir, new_name).replace("\\", "/")
            full_path = os.path.join(settings.MEDIA_ROOT, file_path)
            total_size = 0
            with open(full_path, "wb") as out:
                for i in range(session.total_parts):
                    p = os.path.join(full_temp_dir, f"part_{i}")
                    if not os.path.isfile(p):
                        raise ValueError(f"Отсутствует часть {i}")
                    with open(p, "rb") as inp:
                        data = inp.read()
                        total_size += len(data)
                        out.write(data)
            for i in range(session.total_parts):
                os.unlink(os.path.join(full_temp_dir, f"part_{i}"))
            os.rmdir(full_temp_dir)
            orig_name = session.original_name
            mime = session.mime_type
            is_enc = session.is_encrypted

            scan_status = FileAttachment.ScanStatus.ENCRYPTED if is_enc else FileAttachment.ScanStatus.CLEAN
            att = FileAttachment.objects.create(
                uploader=request.user,
                original_name=orig_name,
                file_path=file_path,
                mime_type=mime,
                size_bytes=total_size,
                storage_type=FileAttachment.StorageType.LOCAL,
                scan_status=scan_status,
                is_encrypted=is_enc,
            )
            if not is_enc and mime and mime.startswith("image/") and total_size <= 50 * 1024 * 1024:
                try:
                    with Image.open(full_path) as img:
                        img = ImageOps.exif_transpose(img)
                        att.width_px = img.width
                        att.height_px = img.height
                        att.save(update_fields=("width_px", "height_px"))
                except Exception:
                    pass
                try:
                    optimize_uploaded_image.delay(str(att.id))
                except Exception:
                    pass
            session.delete()
            return Response(FileAttachmentSerializer(att, context={"request": request}).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            if os.path.isdir(full_temp_dir):
                try:
                    for f in os.listdir(full_temp_dir):
                        os.unlink(os.path.join(full_temp_dir, f))
                    os.rmdir(full_temp_dir)
                except OSError:
                    pass
            session.delete()
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ChunkedUploadCancelView(APIView):
    """Cancel chunked upload: delete session and temp files, free disk space."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        upload_id_raw = request.data.get("upload_id") or request.query_params.get("upload_id")
        if not upload_id_raw:
            return Response({"detail": "Нужен upload_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            session_id = UUID(str(upload_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "Некорректный upload_id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            session = ChunkedUploadSession.objects.get(pk=session_id, user=request.user)
        except ChunkedUploadSession.DoesNotExist:
            return Response({"detail": "Сессия не найдена или уже отменена."}, status=status.HTTP_404_NOT_FOUND)
        _delete_chunked_session_and_files(session)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
            return Response({"detail": "Файл ещё не готов."}, status=status.HTTP_423_LOCKED)
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
            w = max(16, min(2560, w or 0))
            h = max(16, min(2560, h or 0))
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
                    # High quality for chat photos — minimal compression
                    q = 96 if max(w, h) <= 640 else 98 if max(w, h) <= 1400 else 99
                    img.save(buf, format="WEBP", quality=q, method=4)
                    out_type = "image/webp"
                buf.seek(0)
                resp = HttpResponse(buf.read(), content_type=out_type)
                resp["Cache-Control"] = "private, max-age=3600"
                return resp

        response = FileResponse(open(full_path, "rb"), content_type=content_type)
        # Inline for images/audio/video, attachment for others (filename sanitized to prevent header injection)
        disp = "inline" if content_type.startswith(("image/", "audio/", "video/")) and content_type not in INLINE_BLOCKED_MIME_TYPES else "attachment"
        response["Content-Disposition"] = _content_disposition_value(disp, att.original_name)
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response


# ─── Protected media (avatars, chat avatars, backgrounds) ─────────────────────
# Authenticated access only with permission checks. HMAC-token URL prevents brute-force.

ALLOWED_MEDIA_PREFIXES = ("avatars/", "user_avatars/", "chat_avatars/", "channel_avatars/", "chat_backgrounds/")


class ProtectedMediaServeView(APIView):
    """
    Serve avatars and chat media by signed URL (query param t=).
    No auth header required — <img src="..."> cannot send Bearer, so access is by
    HMAC token only. URLs are only issued in authenticated API responses to allowed users.
    """
    permission_classes = [AllowAny]

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

        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        response = FileResponse(open(full_path, "rb"), content_type=content_type)
        response["Content-Disposition"] = "inline"
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response
