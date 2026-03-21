# API для каналов (открытый/закрытый, посты, комментарии, реакции)
import tempfile
from pathlib import Path

from django.db.models import Count
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Channel, ChannelMember, ChannelPost, ChannelPostComment, ChannelPostReaction, ChannelPostView,
    REACTION_EMOJIS, MAX_REACTIONS_PER_USER,
)
from .serializers import (
    ChannelSerializer, ChannelCreateSerializer, ChannelMemberSerializer,
    ChannelPostSerializer, ChannelPostCommentSerializer, JoinChannelSerializer,
)
from .utils import generate_slug, make_verification_code, verify_invite_code
from .telegram_import import import_telegram_export
from apps.payments.plan_limits import can_create_channels, can_import_telegram, RESTRICTION_CODE
from apps.common.image_utils import compress_uploaded_image, create_avatar_thumbnails, delete_avatar_thumbnails, AVATAR_MAX_DIM


def _channel_member_role(request, channel):
    """Возвращает роль текущего пользователя или None."""
    if not request or not request.user.is_authenticated:
        return None
    m = channel.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).first()
    return m.role if m else None


def _can_post(channel, request):
    """Может ли пользователь публиковать посты (owner или admin)."""
    role = _channel_member_role(request, channel)
    return role in (ChannelMember.Role.OWNER, ChannelMember.Role.ADMIN)


def _can_comment(channel, request):
    """Может ли пользователь комментировать (подписчик и comments_enabled)."""
    if not channel.comments_enabled:
        return False
    role = _channel_member_role(request, channel)
    return role is not None  # любой активный участник


def _premium_restriction_response(detail: str):
    return Response(
        {"detail": detail, "code": RESTRICTION_CODE},
        status=status.HTTP_403_FORBIDDEN,
    )


def _ensure_channel_management_allowed(request, channel, detail: str):
    role = _channel_member_role(request, channel)
    if role not in (ChannelMember.Role.OWNER, ChannelMember.Role.ADMIN):
        return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
    if not can_create_channels(request.user):
        return _premium_restriction_response(detail)
    return None


def _ensure_channel_posting_allowed(request, channel):
    role = _channel_member_role(request, channel)
    if role not in (ChannelMember.Role.OWNER, ChannelMember.Role.ADMIN):
        return Response({"detail": "Публиковать посты могут только владелец и администраторы."}, status=status.HTTP_403_FORBIDDEN)
    if not can_create_channels(request.user):
        return _premium_restriction_response("Публикация в канале доступна только с Premium.")
    return None


def _ensure_channel_commenting_allowed(request, channel):
    role = _channel_member_role(request, channel)
    if role is None:
        return Response({"detail": "Нет доступа к каналу."}, status=status.HTTP_403_FORBIDDEN)
    if not channel.comments_enabled:
        return Response({"detail": "Комментарии отключены."}, status=status.HTTP_403_FORBIDDEN)
    return None


def _check_channel_subscriber(request, channel_id):
    """Проверка доступа: пользователь должен быть подписчиком (active)."""
    channel = get_object_or_404(Channel, id=channel_id, is_active=True)
    if not channel.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).exists():
        return None, Response({"detail": "Нет доступа к каналу."}, status=status.HTTP_403_FORBIDDEN)
    return channel, None


class ChannelViewSet(viewsets.ModelViewSet):
    serializer_class = ChannelSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Channel.objects.filter(
                is_active=True,
                members__user=self.request.user,
                members__status=ChannelMember.Status.ACTIVE,
            )
            .distinct()
            .select_related("owner")
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return ChannelCreateSerializer
        return ChannelSerializer

    def create(self, request, *args, **kwargs):
        if not can_create_channels(request.user):
            return Response(
                {"detail": "Для создания канала нужна активная подписка.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )
        data = request.data if request.data is not None else {}
        ser = ChannelCreateSerializer(data=data, context={"request": request})
        ser.is_valid(raise_exception=True)
        channel = ser.save()
        return Response(
            ChannelSerializer(channel, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        channel = self.get_object()
        restriction = _ensure_channel_management_allowed(
            request,
            channel,
            "Управление каналом доступно только с Premium.",
        )
        if restriction is not None:
            return restriction
        if channel.owner_id != request.user.id and _channel_member_role(request, channel) != ChannelMember.Role.OWNER:
            # только владелец может менять is_public и т.д.
            pass
        partial = kwargs.pop("partial", False)
        ser = ChannelSerializer(channel, data=request.data, partial=partial, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def destroy(self, request, *args, **kwargs):
        channel = self.get_object()
        restriction = _ensure_channel_management_allowed(
            request,
            channel,
            "Удаление канала доступно только с Premium.",
        )
        if restriction is not None:
            return restriction
        if channel.owner_id != request.user.id:
            return Response({"detail": "Только владелец может удалить канал."}, status=status.HTTP_403_FORBIDDEN)
        channel.is_active = False
        channel.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="leave")
    def leave(self, request, pk=None):
        channel = self.get_object()
        if channel.owner_id == request.user.id:
            return Response({"detail": "Владелец не может покинуть канал."}, status=status.HTTP_400_BAD_REQUEST)
        membership = channel.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).first()
        if not membership:
            return Response({"detail": "Вы не подписаны на канал."}, status=status.HTTP_400_BAD_REQUEST)
        membership.status = ChannelMember.Status.KICKED
        membership.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="members")
    def list_members(self, request, pk=None):
        channel = self.get_object()
        qs = channel.members.filter(status=ChannelMember.Status.ACTIVE).select_related("user")
        return Response(ChannelMemberSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="mute")
    def toggle_mute(self, request, pk=None):
        """Toggle channel mute for current user."""
        channel = self.get_object()
        membership = channel.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).first()
        if not membership:
            return Response({"detail": "Нет доступа к каналу."}, status=status.HTTP_403_FORBIDDEN)
        membership.is_muted = not bool(membership.is_muted)
        membership.save(update_fields=["is_muted"])
        return Response({"is_muted": membership.is_muted})

    @action(detail=True, methods=["post"], url_path="avatar", parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload_avatar(self, request, pk=None):
        channel = self.get_object()
        restriction = _ensure_channel_management_allowed(
            request,
            channel,
            "Настройки канала доступны только с Premium.",
        )
        if restriction is not None:
            return restriction
        if channel.owner_id != request.user.id:
            return Response({"detail": "Только владелец может менять аватар."}, status=status.HTTP_403_FORBIDDEN)
        avatar_file = request.FILES.get("avatar")
        if avatar_file:
            avatar_file = compress_uploaded_image(avatar_file, max_dim=AVATAR_MAX_DIM)
            old_path = channel.avatar.name if channel.avatar else None
            if channel.avatar:
                channel.avatar.delete(save=False)
            channel.avatar = avatar_file
            channel.save(update_fields=["avatar"])
            if old_path:
                delete_avatar_thumbnails(old_path)
            create_avatar_thumbnails(channel.avatar.name)
        elif request.data.get("remove") == "true":
            old_path = channel.avatar.name if channel.avatar else None
            if channel.avatar:
                channel.avatar.delete(save=False)
                channel.avatar = None
                channel.save(update_fields=["avatar"])
            if old_path:
                delete_avatar_thumbnails(old_path)
        else:
            return Response({"detail": "Файл avatar не найден."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ChannelSerializer(channel, context={"request": request}).data)


class ResolveChannelUsernameView(APIView):
    """Resolve @username to channel for authenticated users (member-only)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        username = (request.query_params.get("username") or "").strip().lstrip("@")
        if not username or len(username) < 3 or len(username) > 30:
            return Response({"detail": "Invalid username."}, status=status.HTTP_400_BAD_REQUEST)

        channel = (
            Channel.objects.filter(
                is_active=True,
                username__iexact=username,
                members__user=request.user,
                members__status=ChannelMember.Status.ACTIVE,
            )
            .select_related("owner")
            .first()
        )
        if not channel:
            return Response({"detail": "Channel not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "id": str(channel.id),
                "username": channel.username,
                "title": channel.title,
            }
        )


class JoinChannelPreviewView(APIView):
    """Превью канала по ссылке (без вступления)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = JoinChannelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        slug = ser.validated_data.get("_slug")
        username = ser.validated_data.get("_username")
        code = ser.validated_data["code"]
        if username:
            channel = get_object_or_404(Channel, username__iexact=username, is_active=True)
            slug = channel.slug
        else:
            channel = get_object_or_404(Channel, slug=slug, is_active=True)
        if not verify_invite_code(slug, code):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        membership = channel.members.filter(user=request.user).first()
        if membership:
            if membership.status == ChannelMember.Status.ACTIVE:
                return Response({
                    "is_public": channel.is_public,
                    "title": channel.title,
                    "already_member": True,
                    "channel_id": str(channel.id),
                })
            if membership.status == ChannelMember.Status.KICKED:
                return Response({"detail": "Вы были исключены из канала.", "is_kicked": True}, status=status.HTTP_403_FORBIDDEN)
            if membership.status == ChannelMember.Status.PENDING:
                return Response({"is_public": channel.is_public, "title": channel.title, "is_pending": True})
        if channel.is_public:
            return Response({
                "is_public": True,
                "title": channel.title,
                "description": channel.description or "",
                "members_count": channel.members.filter(status=ChannelMember.Status.ACTIVE).count(),
            })
        return Response({"is_public": False, "title": channel.title})


class JoinChannelView(APIView):
    """Вступить в канал по ссылке (открытый — сразу, закрытый — запрос на одобрение)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = JoinChannelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        slug = ser.validated_data.get("_slug")
        username = ser.validated_data.get("_username")
        code = ser.validated_data["code"]
        if username:
            channel = get_object_or_404(Channel, username__iexact=username, is_active=True)
            slug = channel.slug
        else:
            channel = get_object_or_404(Channel, slug=slug, is_active=True)
        if not verify_invite_code(slug, code):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        membership = channel.members.filter(user=request.user).first()
        if membership:
            if membership.status == ChannelMember.Status.ACTIVE:
                data = ChannelSerializer(channel, context={"request": request}).data
                data["already_member"] = True
                return Response(data)
            if membership.status == ChannelMember.Status.KICKED:
                return Response({"detail": "Вы были исключены из канала."}, status=status.HTTP_403_FORBIDDEN)
            if membership.status == ChannelMember.Status.PENDING:
                return Response({"detail": "Запрос уже отправлен. Ожидайте подтверждения."})
        if channel.is_public:
            ChannelMember.objects.get_or_create(
                channel=channel, user=request.user,
                defaults={"role": ChannelMember.Role.SUBSCRIBER, "status": ChannelMember.Status.ACTIVE},
            )
            channel.refresh_from_db()
            return Response(ChannelSerializer(channel, context={"request": request}).data, status=status.HTTP_201_CREATED)
        ChannelMember.objects.get_or_create(
            channel=channel, user=request.user,
            defaults={"role": ChannelMember.Role.SUBSCRIBER, "status": ChannelMember.Status.PENDING},
        )
        return Response({"detail": "Запрос на вступление отправлен. Ожидайте подтверждения от владельца."}, status=status.HTTP_202_ACCEPTED)


class ChannelImportTelegramView(APIView):
    """POST: импорт истории канала из ZIP-архива экспорта Telegram Desktop."""
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request, channel_id):
        channel = get_object_or_404(Channel, id=channel_id, is_active=True)
        if not channel.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет доступа к каналу."}, status=status.HTTP_403_FORBIDDEN)
        if not _can_post(channel, request):
            return Response({"detail": "Импорт доступен только владельцу и администраторам канала."}, status=status.HTTP_403_FORBIDDEN)
        if not can_import_telegram(request.user):
            return _premium_restriction_response("Импорт из Telegram доступен только с Premium.")

        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Передайте ZIP-архив экспорта Telegram (поле file)."}, status=status.HTTP_400_BAD_REQUEST)
        name = (file_obj.name or "").lower()
        if not name.endswith(".zip"):
            return Response({"detail": "Файл должен быть ZIP-архивом экспорта Telegram Desktop."}, status=status.HTTP_400_BAD_REQUEST)

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            for chunk in file_obj.chunks():
                tmp.write(chunk)
            tmp_path = Path(tmp.name)
        try:
            created_count, errors = import_telegram_export(channel, request.user, tmp_path)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

        return Response({
            "created": created_count,
            "errors": errors[:20],
        }, status=status.HTTP_200_OK)


class ChannelPostListCreateView(APIView):
    """Список постов и создание поста (cursor pagination)."""

    def get(self, request, channel_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        limit = min(int(request.query_params.get("limit", 50)), 100)
        since = request.query_params.get("since")
        before = request.query_params.get("before")
        qs = (
            ChannelPost.objects.filter(channel=channel, is_deleted=False)
            .select_related("author", "file", "forwarded_from", "forwarded_from_chat", "sender_device")
            .prefetch_related("reactions", "files")
            .annotate(_views_count=Count("views", distinct=True))
        )
        if since:
            since_dt = parse_datetime(since)
            if since_dt:
                qs = qs.filter(created_at__gt=since_dt)
            posts = list(qs.order_by("created_at")[:limit])
            has_more = False
        elif before:
            before_dt = parse_datetime(before)
            if before_dt:
                qs = qs.filter(created_at__lt=before_dt)
            posts_desc = list(qs.order_by("-created_at")[:limit + 1])
            has_more = len(posts_desc) > limit
            posts = list(reversed(posts_desc[:limit]))
        else:
            posts_desc = list(qs.order_by("-created_at")[:limit + 1])
            has_more = len(posts_desc) > limit
            posts = list(reversed(posts_desc[:limit]))

        # Record views (unique per user×post) for returned posts
        try:
            ChannelPostView.objects.bulk_create(
                [ChannelPostView(post=p, user=request.user) for p in posts],
                ignore_conflicts=True,
            )
            # Update annotated counts for response (cheap per-item refresh)
            view_counts = dict(
                ChannelPostView.objects.filter(post__in=posts)
                .values_list("post_id")
                .annotate(c=Count("id"))
            )
            for p in posts:
                setattr(p, "_views_count", view_counts.get(p.id, getattr(p, "_views_count", 0)))
        except Exception:
            pass
        ctx = {"request": request}
        response = Response(ChannelPostSerializer(posts, many=True, context=ctx).data)
        response["X-Has-More"] = "true" if has_more else "false"
        return response

    def post(self, request, channel_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_posting_allowed(request, channel)
        if restriction is not None:
            return restriction
        ser = ChannelPostSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save(channel=channel, author=request.user)
        return Response(ser.data, status=status.HTTP_201_CREATED)


class ChannelPostDetailView(APIView):
    """GET / PATCH / DELETE поста."""

    def get(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        return Response(ChannelPostSerializer(post, context={"request": request}).data)

    def patch(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_posting_allowed(request, channel)
        if restriction is not None:
            return restriction
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        if post.author_id != request.user.id and not _can_post(channel, request):
            return Response({"detail": "Нет прав на редактирование."}, status=status.HTTP_403_FORBIDDEN)
        if post.msg_type != "text":
            return Response({"detail": "Редактировать можно только текстовые посты."}, status=status.HTTP_400_BAD_REQUEST)
        content = request.data.get("content")
        if content is None:
            return Response({"detail": "Укажите content."}, status=status.HTTP_400_BAD_REQUEST)
        post.content = content
        post.edited_at = timezone.now()
        post.save(update_fields=["content", "edited_at"])
        return Response(ChannelPostSerializer(post, context={"request": request}).data)

    def delete(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_posting_allowed(request, channel)
        if restriction is not None:
            return restriction
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        if post.author_id != request.user.id and not _can_post(channel, request):
            return Response({"detail": "Нет прав на удаление."}, status=status.HTTP_403_FORBIDDEN)
        post.is_deleted = True
        post.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChannelPostReactionView(APIView):
    """POST: поставить/снять реакцию на пост."""

    def post(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        emoji = (request.data.get("emoji") or "").strip()
        if emoji:
            if emoji not in REACTION_EMOJIS:
                return Response({"detail": f"Допустимые эмодзи: {', '.join(REACTION_EMOJIS)}."}, status=status.HTTP_400_BAD_REQUEST)
            existing = ChannelPostReaction.objects.filter(post=post, user=request.user, emoji=emoji).first()
            if existing:
                existing.delete()
            else:
                count = ChannelPostReaction.objects.filter(post=post, user=request.user).count()
                if count >= MAX_REACTIONS_PER_USER:
                    return Response({"detail": f"Не более {MAX_REACTIONS_PER_USER} реакций на пост."}, status=status.HTTP_400_BAD_REQUEST)
                ChannelPostReaction.objects.create(post=post, user=request.user, emoji=emoji)
        else:
            ChannelPostReaction.objects.filter(post=post, user=request.user).delete()
        post.refresh_from_db()
        return Response(ChannelPostSerializer(post, context={"request": request}).data)


class ChannelPostCommentListCreateView(APIView):
    """Список комментариев к посту и создание комментария."""

    def get(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        limit = min(int(request.query_params.get("limit", 50)), 100)
        offset = max(int(request.query_params.get("offset", 0)), 0)
        qs = (
            ChannelPostComment.objects.filter(post=post, is_deleted=False)
            .select_related("author", "file", "reply_to", "reply_to__author")
            .prefetch_related("files")
            .order_by("created_at")[offset:offset + limit]
        )
        return Response(ChannelPostCommentSerializer(qs, many=True, context={"request": request}).data)

    def post(self, request, channel_id, post_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_commenting_allowed(request, channel)
        if restriction is not None:
            return restriction
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel, is_deleted=False)
        ser = ChannelPostCommentSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save(post=post, author=request.user)
        return Response(ser.data, status=status.HTTP_201_CREATED)


class ChannelPostCommentDetailView(APIView):
    """GET / PATCH / DELETE комментария."""

    def get(self, request, channel_id, post_id, comment_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel)
        comment = get_object_or_404(ChannelPostComment, id=comment_id, post=post, is_deleted=False)
        return Response(ChannelPostCommentSerializer(comment, context={"request": request}).data)

    def patch(self, request, channel_id, post_id, comment_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_commenting_allowed(request, channel)
        if restriction is not None:
            return restriction
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel)
        comment = get_object_or_404(ChannelPostComment, id=comment_id, post=post, is_deleted=False)
        if comment.author_id != request.user.id:
            return Response({"detail": "Можно редактировать только свой комментарий."}, status=status.HTTP_403_FORBIDDEN)
        content = request.data.get("content")
        if content is None:
            return Response({"detail": "Укажите content."}, status=status.HTTP_400_BAD_REQUEST)
        comment.content = content
        comment.edited_at = timezone.now()
        comment.save(update_fields=["content", "edited_at"])
        return Response(ChannelPostCommentSerializer(comment, context={"request": request}).data)

    def delete(self, request, channel_id, post_id, comment_id):
        channel, err = _check_channel_subscriber(request, channel_id)
        if err is not None:
            return err
        restriction = _ensure_channel_commenting_allowed(request, channel)
        if restriction is not None:
            return restriction
        post = get_object_or_404(ChannelPost, id=post_id, channel=channel)
        comment = get_object_or_404(ChannelPostComment, id=comment_id, post=post, is_deleted=False)
        if comment.author_id != request.user.id:
            return Response({"detail": "Можно удалить только свой комментарий."}, status=status.HTTP_403_FORBIDDEN)
        comment.is_deleted = True
        comment.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChannelMemberApproveRejectView(APIView):
    """Владелец/админ: одобрить или отклонить заявку на вступление."""

    def post(self, request, channel_id):
        channel = get_object_or_404(Channel, id=channel_id, is_active=True)
        restriction = _ensure_channel_management_allowed(
            request,
            channel,
            "Управление участниками канала доступно только с Premium.",
        )
        if restriction is not None:
            return restriction
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChannelMember, id=member_id, channel=channel, status=ChannelMember.Status.PENDING)
        action_type = request.data.get("action")  # "approve" | "reject"
        if action_type == "approve":
            member.status = ChannelMember.Status.ACTIVE
            member.save()
            return Response(ChannelMemberSerializer(member).data)
        if action_type == "reject":
            member.status = ChannelMember.Status.KICKED
            member.save()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"detail": "Укажите action: approve или reject."}, status=status.HTTP_400_BAD_REQUEST)


class ChannelMemberKickView(APIView):
    """Владелец/админ: исключить участника."""

    def post(self, request, channel_id):
        channel = get_object_or_404(Channel, id=channel_id, is_active=True)
        restriction = _ensure_channel_management_allowed(
            request,
            channel,
            "Управление участниками канала доступно только с Premium.",
        )
        if restriction is not None:
            return restriction
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChannelMember, id=member_id, channel=channel, status=ChannelMember.Status.ACTIVE)
        if member.role == ChannelMember.Role.OWNER:
            return Response({"detail": "Нельзя исключить владельца."}, status=status.HTTP_400_BAD_REQUEST)
        if member.role == ChannelMember.Role.ADMIN and channel.owner_id != request.user.id:
            return Response({"detail": "Исключить администратора может только владелец."}, status=status.HTTP_403_FORBIDDEN)
        member.status = ChannelMember.Status.KICKED
        member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
