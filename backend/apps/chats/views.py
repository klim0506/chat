import logging
from datetime import timedelta
from uuid import UUID
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Prefetch, Subquery, OuterRef
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Chat, ChatMember, Message, ChatFolder, ChatFolderChat, DEFAULT_MAX_MEMBERS
from .message_views import _process_delete_after_read
from .serializers import ChatSerializer, ChatCreateSerializer, ChatMemberSerializer, JoinChatSerializer
from .services import create_favorites_chat
from .utils import verify_invite_code, generate_slug, make_verification_code
from rest_framework.permissions import IsAuthenticated
from apps.payments.plan_limits import get_max_pinned_chats, RESTRICTION_CODE
from apps.users.models import User
from apps.common.image_utils import compress_uploaded_image, create_avatar_thumbnails, delete_avatar_thumbnails, AVATAR_MAX_DIM, BACKGROUND_MAX_DIM

logger = logging.getLogger(__name__)


def _broadcast_mark_read(chat_id, user_id, last_read_at):
    """Notify chat members that a user has read the chat (for read receipts)."""
    try:
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"chat_{chat_id}",
                {
                    "type": "chat.mark_read.broadcast",
                    "user_id": str(user_id),
                    "last_read_at": last_read_at.isoformat() if hasattr(last_read_at, "isoformat") else last_read_at,
                },
            )
    except Exception:
        pass


class ChatViewSet(viewsets.ModelViewSet):
    serializer_class = ChatSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        current_user_membership = Prefetch(
            "members",
            queryset=ChatMember.objects.filter(
                user=user,
                status=ChatMember.Status.ACTIVE,
            ).only("id", "chat_id", "user_id", "status", "last_read_at", "muted_until", "pin_order", "is_archived"),
            to_attr="current_user_membership",
        )

        folder_prefetch = Prefetch(
            "folder_memberships",
            queryset=ChatFolderChat.objects.filter(folder__user=user).select_related("folder"),
            to_attr="_user_folder_memberships",
        )
        # Prefetch the last non-deleted message for chat list preview
        last_message_prefetch = Prefetch(
            "messages",
            queryset=Message.objects.filter(is_deleted=False).order_by("-created_at")[:1].select_related("file"),
            to_attr="_prefetched_last_message",
        )
        # Last message timestamp for chat list sorting
        last_message_at_subquery = Message.objects.filter(
            chat_id=OuterRef("pk"),
            is_deleted=False,
        ).order_by("-created_at").values("created_at")[:1]

        return (
            Chat.objects.filter(
                is_active=True,
                members__user=user,
                members__status=ChatMember.Status.ACTIVE,
            )
            .distinct()
            .annotate(
                _members_count=Count(
                    "members",
                    filter=Q(members__status=ChatMember.Status.ACTIVE),
                ),
                _last_message_at=Subquery(last_message_at_subquery),
            )
            .order_by("-_last_message_at", "-created_at")
            .select_related("owner")
            .prefetch_related("members__user", "members__user__personal_channel", current_user_membership, folder_prefetch, last_message_prefetch)
        )

    @action(detail=False, methods=["get"], url_path="favorites")
    def get_favorites(self, request):
        """Return or create the current user's «Избранное» chat. Always returns one chat."""
        chat = create_favorites_chat(request.user)
        serializer = self.get_serializer(chat)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="pins")
    def set_pins(self, request):
        raw_ids = request.data.get("chat_ids", [])
        if not isinstance(raw_ids, list):
            return Response({"detail": "chat_ids must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        cleaned: list[UUID] = []
        seen: set[UUID] = set()
        for item in raw_ids:
            try:
                cid = UUID(str(item))
            except (TypeError, ValueError):
                return Response({"detail": "Invalid chat id in chat_ids."}, status=status.HTTP_400_BAD_REQUEST)
            if cid in seen:
                continue
            seen.add(cid)
            cleaned.append(cid)

        max_pinned = get_max_pinned_chats(request.user)
        if len(cleaned) > max_pinned:
            return Response(
                {"detail": f"Максимум {max_pinned} закреплённых чатов на вашем тарифе. Оформите подписку для до 10.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )

        memberships = ChatMember.objects.filter(
            user=request.user,
            status=ChatMember.Status.ACTIVE,
            chat_id__in=cleaned,
        )
        if memberships.count() != len(cleaned):
            return Response({"detail": "Some chats are unavailable."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            ChatMember.objects.filter(user=request.user, status=ChatMember.Status.ACTIVE).exclude(
                pin_order__isnull=True
            ).update(pin_order=None)

            by_chat_id = {m.chat_id: m for m in memberships}
            to_update = []
            for idx, cid in enumerate(cleaned, start=1):
                m = by_chat_id.get(cid)
                if not m:
                    continue
                m.pin_order = idx
                to_update.append(m)
            if to_update:
                ChatMember.objects.bulk_update(to_update, ["pin_order"])

        return Response({"pinned_chat_ids": [str(cid) for cid in cleaned]})

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        """Mark chat as read."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.last_read_at = timezone.now()
        membership.save(update_fields=["last_read_at"])
        _process_delete_after_read(str(chat.id), request.user.id, membership.last_read_at)
        _broadcast_mark_read(chat.id, request.user.id, membership.last_read_at)
        return Response({"last_read_at": membership.last_read_at})

    @action(detail=True, methods=["post"], url_path="mark-unread")
    def mark_unread(self, request, pk=None):
        """Mark chat as unread (reset last_read_at)."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.last_read_at = None
        membership.save(update_fields=["last_read_at"])
        _broadcast_mark_read(chat.id, request.user.id, None)
        return Response({"last_read_at": None})

    @action(detail=True, methods=["post"], url_path="mute")
    def mute(self, request, pk=None):
        """Set or clear mute mode. duration: 1h, 3h, 8h, forever, off."""
        from django.utils import timezone

        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)

        duration = (request.data.get("duration") or "off").strip().lower()
        now = timezone.now()
        forever = timezone.datetime(9999, 12, 31, 23, 59, 59, tzinfo=timezone.get_current_timezone())

        if duration == "off":
            membership.muted_until = None
        elif duration == "1h":
            membership.muted_until = now + timedelta(hours=1)
        elif duration == "3h":
            membership.muted_until = now + timedelta(hours=3)
        elif duration == "8h":
            membership.muted_until = now + timedelta(hours=8)
        elif duration == "forever":
            membership.muted_until = forever
        else:
            return Response(
                {"detail": "Недопустимый duration. Допустимо: 1h, 3h, 8h, forever, off."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        membership.save(update_fields=["muted_until"])
        return Response({
            "is_muted": membership.is_muted,
            "muted_until": membership.muted_until.isoformat() if membership.muted_until else None,
        })

    @action(detail=True, methods=["post"], url_path="toggle-archive")
    def toggle_archive(self, request, pk=None):
        """Toggle archived status for a chat."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.is_archived = not membership.is_archived
        membership.save(update_fields=["is_archived"])
        return Response({"is_archived": membership.is_archived})

    @action(detail=True, methods=["post"], url_path="leave")
    def leave(self, request, pk=None):
        """Leave chat. Admin must assign another administrator first."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if getattr(chat, "is_favorites", False):
            return Response({"detail": "Из чата «Избранное» выйти нельзя."}, status=status.HTTP_400_BAD_REQUEST)
        # DM: member can leave (remove self from chat). Group: admin must assign another admin first.
        if not getattr(chat, "is_personal", False):
            admins_count = chat.members.filter(
                status=ChatMember.Status.ACTIVE, role=ChatMember.Role.ADMIN
            ).count()
            if membership.role == ChatMember.Role.ADMIN and admins_count <= 1:
                return Response(
                    {"detail": "Назначьте другого администратора перед выходом из чата."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_serializer_class(self):
        if self.action == "create":
            return ChatCreateSerializer
        return ChatSerializer

    def create(self, request, *args, **kwargs):
        ser = ChatCreateSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        for attempt in (1, 2):
            try:
                chat = ser.save()
                return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)
            except IntegrityError as e:
                logger.warning("Chat create IntegrityError (attempt %s): %s", attempt, e, exc_info=True)
                if attempt == 2:
                    return Response(
                        {"detail": "Не удалось создать чат. Попробуйте ещё раз."},
                        status=status.HTTP_409_CONFLICT,
                    )
                ser = ChatCreateSerializer(data=request.data, context={"request": request})
                ser.is_valid(raise_exception=True)
            except Exception as e:
                logger.exception("Chat create unexpected error: %s", e)
                return Response(
                    {"detail": "Серверная ошибка. Попробуйте позже."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

    def partial_update(self, request, *args, **kwargs):
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может редактировать чат."}, status=status.HTTP_403_FORBIDDEN)
        allowed = {"title", "title_icon", "description", "slow_mode_seconds"}
        update_data = {k: v for k, v in request.data.items() if k in allowed}
        for field, value in update_data.items():
            setattr(chat, field, value)
        if update_data:
            chat.save(update_fields=list(update_data.keys()))
        return Response(ChatSerializer(chat, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="avatar",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload_avatar(self, request, pk=None):
        """Upload or remove chat avatar."""
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может менять аватарку."}, status=status.HTTP_403_FORBIDDEN)
        avatar_file = request.FILES.get("avatar")
        if avatar_file:
            avatar_file = compress_uploaded_image(avatar_file, max_dim=AVATAR_MAX_DIM)
            old_path = chat.avatar.name if chat.avatar else None
            if chat.avatar:
                chat.avatar.delete(save=False)
            chat.avatar = avatar_file
            chat.save(update_fields=["avatar"])
            if old_path:
                delete_avatar_thumbnails(old_path)
            create_avatar_thumbnails(chat.avatar.name)
        elif request.data.get("remove") == "true":
            old_path = chat.avatar.name if chat.avatar else None
            if chat.avatar:
                chat.avatar.delete(save=False)
                chat.avatar = None
                chat.save(update_fields=["avatar"])
            if old_path:
                delete_avatar_thumbnails(old_path)
        else:
            return Response({"detail": "Файл avatar не найден."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ChatSerializer(chat, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="background",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload_background(self, request, pk=None):
        """Upload or remove chat background image."""
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может менять фон чата."}, status=status.HTTP_403_FORBIDDEN)
        bg_file = request.FILES.get("background")
        if bg_file:
            bg_file = compress_uploaded_image(bg_file, max_dim=BACKGROUND_MAX_DIM)
            if chat.background:
                chat.background.delete(save=False)
            chat.background = bg_file
            chat.save(update_fields=["background"])
        elif request.data.get("remove") == "true":
            if chat.background:
                chat.background.delete(save=False)
                chat.background = None
                chat.save(update_fields=["background"])
        else:
            return Response({"detail": "Файл background не найден."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ChatSerializer(chat, context={"request": request}).data)

    def destroy(self, request, *args, **kwargs):
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может удалить чат."}, status=status.HTTP_403_FORBIDDEN)
        chat.is_active = False
        chat.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CreateOrGetDMView(APIView):
    """Get or create a DM chat with a user. POST { \"user_id\": \"uuid\" }."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_id = request.data.get("user_id")
        is_secret = request.data.get("is_secret", False)
        if not user_id:
            return Response({"detail": "user_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Пользователь не найден."}, status=status.HTTP_400_BAD_REQUEST)
        if target_user.pk == request.user.pk:
            return Response({"detail": "Нельзя написать самому себе."}, status=status.HTTP_400_BAD_REQUEST)

        def find_existing_dm(*, secret: bool):
            my_chat_ids = ChatMember.objects.filter(
                user=request.user, status=ChatMember.Status.ACTIVE
            ).values_list("chat_id", flat=True)
            their_chat_ids = ChatMember.objects.filter(
                user=target_user, status=ChatMember.Status.ACTIVE
            ).values_list("chat_id", flat=True)
            return (
                Chat.objects.filter(
                    is_active=True,
                    is_personal=True,
                    is_secret=secret,
                    id__in=my_chat_ids,
                )
                .filter(id__in=their_chat_ids)
                .annotate(active_count=Count("members", filter=Q(members__status=ChatMember.Status.ACTIVE)))
                .filter(active_count=2)
                .order_by("created_at")
                .first()
            )

        with transaction.atomic():
            existing = find_existing_dm(secret=is_secret)
            if existing:
                return Response(ChatSerializer(existing, context={"request": request}).data)

            # Privacy check: who can send DMs
            if target_user.dm_privacy == User.DM_PRIVACY_NOBODY:
                return Response(
                    {"detail": "Пользователь запретил писать ему в личные сообщения."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if target_user.dm_privacy == User.DM_PRIVACY_CONTACTS:
                from apps.users.models import Contact
                if not Contact.objects.filter(owner=target_user, contact_user=request.user).exists():
                    return Response(
                        {"detail": "Пользователь принимает сообщения только от контактов."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            slug = generate_slug()
            while Chat.objects.filter(slug=slug).exists():
                slug = generate_slug()
            chat = Chat.objects.create(
                title="Секретный чат" if is_secret else "Личный чат",
                description="",
                slug=slug,
                verification_code=make_verification_code(slug),
                chat_type=None,
                is_personal=True,
                is_secret=is_secret,
                max_members=DEFAULT_MAX_MEMBERS,
                owner=request.user,
                is_active=True,
            )
            ChatMember.objects.create(
                chat=chat,
                user=request.user,
                role=ChatMember.Role.ADMIN,
                status=ChatMember.Status.ACTIVE,
            )
            ChatMember.objects.create(
                chat=chat,
                user=target_user,
                role=ChatMember.Role.MEMBER,
                status=ChatMember.Status.ACTIVE,
            )
            existing = find_existing_dm(secret=is_secret)
            if existing and existing.id != chat.id:
                return Response(ChatSerializer(existing, context={"request": request}).data)
        return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)


class JoinChatPreviewView(APIView):
    """Chat preview by invite link (without joining). Returns different data for open/closed chats."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = JoinChatSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        slug, code = ser.validated_data["slug"], ser.validated_data["code"]
        if not verify_invite_code(slug, code):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        chat = get_object_or_404(Chat, slug=slug, is_active=True)
        if getattr(chat, "is_personal", False) or getattr(chat, "is_favorites", False):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)

        membership = ChatMember.objects.filter(chat=chat, user=request.user).first()
        if membership:
            if membership.status == ChatMember.Status.ACTIVE:
                return Response({
                    "chat_type": chat.chat_type or "open",
                    "title": chat.title,
                    "already_member": True,
                    "chat_id": str(chat.id),
                })
            if membership.status == ChatMember.Status.KICKED:
                return Response({"detail": "Вы были исключены из чата.", "is_kicked": True}, status=status.HTTP_403_FORBIDDEN)
            if membership.status == ChatMember.Status.PENDING:
                return Response({
                    "chat_type": chat.chat_type or "open",
                    "title": chat.title,
                    "is_pending": True,
                })

        active_count = chat.members.filter(status=ChatMember.Status.ACTIVE).count()
        if active_count >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)

        if chat.chat_type == Chat.ChatType.CLOSED:
            return Response({
                "chat_type": "closed",
                "title": chat.title,
            })

        avatar_handle = None
        if chat.avatar:
            from apps.files.access_handles import make_chat_avatar_handle

            avatar_handle = make_chat_avatar_handle(chat.id)
        return Response({
            "chat_type": "open",
            "title": chat.title,
            "description": chat.description or "",
            "avatar_handle": avatar_handle,
            "members_count": active_count,
        })


class JoinChatView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = JoinChatSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        slug, code = ser.validated_data["slug"], ser.validated_data["code"]
        if not verify_invite_code(slug, code):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        chat = get_object_or_404(Chat, slug=slug, is_active=True)
        if getattr(chat, "is_personal", False) or getattr(chat, "is_favorites", False):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        membership = ChatMember.objects.filter(chat=chat, user=request.user).first()
        if membership:
            if membership.status == ChatMember.Status.ACTIVE:
                data = ChatSerializer(chat, context={"request": request}).data
                data["already_member"] = True
                return Response(data)
            if membership.status == ChatMember.Status.KICKED:
                return Response({"detail": "Вы были исключены из чата."}, status=status.HTTP_403_FORBIDDEN)
            if membership.status == ChatMember.Status.PENDING:
                return Response({"detail": "Запрос уже отправлен. Ожидайте подтверждения."})
        if chat.members.filter(status=ChatMember.Status.ACTIVE).count() >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)
        if chat.chat_type and chat.chat_type == Chat.ChatType.OPEN:
            ChatMember.objects.get_or_create(chat=chat, user=request.user, defaults={"role": ChatMember.Role.MEMBER, "status": ChatMember.Status.ACTIVE})
            chat.refresh_from_db()
            return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)
        ChatMember.objects.get_or_create(chat=chat, user=request.user, defaults={"role": ChatMember.Role.MEMBER, "status": ChatMember.Status.PENDING})
        # Notify admins (owner + admins) via WebSocket
        admin_ids = list(
            chat.members.filter(
                status=ChatMember.Status.ACTIVE
            ).filter(
                Q(user_id=chat.owner_id) | Q(role=ChatMember.Role.ADMIN)
            ).values_list("user_id", flat=True).distinct()
        )
        admin_ids = [uid for uid in admin_ids if uid != request.user.id]
        requester_name = request.user.display_name or request.user.username or request.user.phone or str(request.user.id)
        try:
            layer = get_channel_layer()
            if layer:
                for admin_id in admin_ids:
                    async_to_sync(layer.group_send)(
                        f"user_{admin_id}",
                        {
                            "type": "notify.join_request",
                            "chat_id": str(chat.id),
                            "chat_title": chat.title,
                            "requester_name": requester_name,
                        },
                    )
        except Exception:
            pass
        return Response({"detail": "Запрос на вступление отправлен. Ожидайте подтверждения от владельца."}, status=status.HTTP_202_ACCEPTED)


class ChatMemberViewSet(viewsets.ViewSet):
    def list(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if not chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        ser = ChatMemberSerializer(chat.members.select_related("user").all(), many=True)
        return Response(ser.data)

    @action(detail=False, methods=["post"], url_path="approve")
    def approve(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может подтверждать."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.PENDING)
        if chat.members.filter(status=ChatMember.Status.ACTIVE).count() >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)
        member.status = ChatMember.Status.ACTIVE
        member.save()
        return Response(ChatMemberSerializer(member).data)

    @action(detail=False, methods=["post"], url_path="reject")
    def reject(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может отклонять."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.PENDING)
        member.status = ChatMember.Status.KICKED
        member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="kick")
    def kick(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id and not chat.members.filter(user=request.user, role=ChatMember.Role.ADMIN, status=ChatMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.ACTIVE)
        if member.user_id == chat.owner_id:
            return Response({"detail": "Нельзя исключить владельца."}, status=status.HTTP_400_BAD_REQUEST)
        member.status = ChatMember.Status.KICKED
        member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="invite")
    def invite(self, request, chat_id=None):
        """Invite a user to a group by user_id or username. Owner/admin only."""
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if getattr(chat, "is_personal", False) or getattr(chat, "is_favorites", False):
            return Response({"detail": "Нельзя приглашать в личный чат или «Избранное»."}, status=status.HTTP_400_BAD_REQUEST)
        my_membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not my_membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if my_membership.role != ChatMember.Role.ADMIN and chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец или администратор может приглашать."}, status=status.HTTP_403_FORBIDDEN)
        user_id = request.data.get("user_id")
        username = request.data.get("username", "").strip()
        if not user_id and not username:
            return Response({"detail": "Укажите user_id или username."}, status=status.HTTP_400_BAD_REQUEST)
        if user_id and username:
            return Response({"detail": "Укажите только user_id или только username."}, status=status.HTTP_400_BAD_REQUEST)
        if user_id:
            try:
                invited_user = User.objects.get(pk=user_id)
            except (User.DoesNotExist, ValueError, TypeError):
                return Response({"detail": "Пользователь не найден."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            invited_user = User.objects.filter(username__iexact=username).first()
            if not invited_user:
                return Response({"detail": "Пользователь не найден."}, status=status.HTTP_400_BAD_REQUEST)
        if invited_user.pk == request.user.pk:
            return Response({"detail": "Нельзя пригласить самого себя."}, status=status.HTTP_400_BAD_REQUEST)
        if invited_user.add_to_group_privacy == User.ADD_TO_GROUP_NOBODY:
            return Response(
                {"detail": "Пользователь запретил добавлять его в группы."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if invited_user.add_to_group_privacy == User.ADD_TO_GROUP_CONTACTS:
            from apps.users.models import Contact
            if not Contact.objects.filter(owner=invited_user, contact_user=request.user).exists():
                return Response(
                    {"detail": "Пользователь разрешает добавлять в группы только контактам."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        if chat.members.filter(status=ChatMember.Status.ACTIVE).count() >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)
        existing = ChatMember.objects.filter(chat=chat, user=invited_user).first()
        if existing:
            if existing.status == ChatMember.Status.ACTIVE:
                return Response(
                    ChatSerializer(chat, context={"request": request}).data,
                    status=status.HTTP_200_OK,
                )
            if existing.status == ChatMember.Status.PENDING:
                return Response({"detail": "Запрос уже отправлен. Ожидайте подтверждения от владельца."}, status=status.HTTP_202_ACCEPTED)
            if existing.status == ChatMember.Status.KICKED:
                return Response({"detail": "Пользователь был исключён из чата."}, status=status.HTTP_403_FORBIDDEN)
        is_open = chat.chat_type == Chat.ChatType.OPEN
        member_status = ChatMember.Status.ACTIVE if is_open else ChatMember.Status.PENDING
        ChatMember.objects.get_or_create(
            chat=chat, user=invited_user,
            defaults={"role": ChatMember.Role.MEMBER, "status": member_status},
        )
        chat.refresh_from_db()
        if is_open:
            # Notify the invited user so the chat appears in their list and they see "You were added to the group"
            try:
                layer = get_channel_layer()
                if layer:
                    async_to_sync(layer.group_send)(
                        f"user_{invited_user.id}",
                        {
                            "type": "notify.added_to_chat",
                            "chat_id": str(chat.id),
                            "chat_title": chat.title,
                        },
                    )
            except Exception:
                pass
            return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)
        return Response({"detail": "Запрос на вступление отправлен. Ожидайте подтверждения от владельца."}, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=["post"], url_path="set-admin")
    def set_admin(self, request, chat_id=None):
        """Promote a member to admin. Current admin or chat owner only."""
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        my_membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not my_membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if my_membership.role != ChatMember.Role.ADMIN and chat.owner_id != request.user.id:
            return Response({"detail": "Только администратор или владелец может назначать админа."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.ACTIVE)
        member.role = ChatMember.Role.ADMIN
        member.save(update_fields=["role"])
        return Response(ChatMemberSerializer(chat.members.select_related("user").all(), many=True).data)
