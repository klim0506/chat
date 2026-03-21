from django.conf import settings
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from .models import (
    Chat, ChatMember, Message, MessageReaction, ScheduledMessage, UserPinnedMessage, ChatPinnedMessage,
    ChatFolder, ChatFolderChat,
    REACTION_EMOJIS, DEFAULT_MAX_MEMBERS,
    Channel, ChannelMember, ChannelPost, ChannelPostComment, ChannelPostReaction,
)
from apps.files.serializers import FileAttachmentSerializer
from apps.files.access_handles import (
    make_channel_avatar_handle,
    make_chat_avatar_handle,
    make_chat_background_handle,
)
from apps.users.serializers import UserSerializer
from apps.payments.plan_limits import can_send_video_circle_today, can_create_poll, PlanRestrictionError
from .utils import generate_slug, make_verification_code


class ChatMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ChatMember
        fields = ("id", "user", "role", "status", "joined_at")


class ChatSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    members_count = serializers.SerializerMethodField()
    invite_link = serializers.SerializerMethodField()
    chat_type = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    is_muted = serializers.SerializerMethodField()
    muted_until = serializers.SerializerMethodField()
    pin_order = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    is_expanded = serializers.SerializerMethodField()
    expanded_until = serializers.DateTimeField(read_only=True)
    effective_max_members = serializers.SerializerMethodField()
    avatar_handle = serializers.SerializerMethodField()
    avatar_handle_small = serializers.SerializerMethodField()
    avatar_handle_medium = serializers.SerializerMethodField()
    background_handle = serializers.SerializerMethodField()
    other_member = serializers.SerializerMethodField()
    pinned_message = serializers.SerializerMethodField()
    pinned_messages = serializers.SerializerMethodField()
    max_pins = serializers.SerializerMethodField()
    my_pinned_messages = serializers.SerializerMethodField()
    last_message_preview = serializers.SerializerMethodField()
    last_message_at = serializers.SerializerMethodField()
    last_message_is_mine = serializers.SerializerMethodField()
    last_message_read_status = serializers.SerializerMethodField()
    folder_ids = serializers.SerializerMethodField()
    pending_join_requests_count = serializers.SerializerMethodField()

    class Meta:
        model = Chat
        fields = (
            "id", "title", "title_icon", "description", "slug", "chat_type", "is_personal", "is_secret", "is_favorites", "max_members", "owner",
            "members_count", "invite_link", "is_active", "created_at", "last_message_at", "has_telegram_import",
            "unread_count", "is_muted", "muted_until",
            "pin_order", "is_archived",
            "is_expanded", "expanded_until", "effective_max_members",
            "avatar_handle", "avatar_handle_small", "avatar_handle_medium", "background_handle", "other_member",
            "pinned_message", "pinned_messages", "max_pins", "my_pinned_messages",
            "last_message_preview", "last_message_is_mine", "last_message_read_status", "folder_ids", "pending_join_requests_count",
            "slow_mode_seconds",
        )

    def _get_membership(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        prefetched = getattr(obj, "current_user_membership", None)
        if prefetched is not None:
            return prefetched[0] if len(prefetched) > 0 else None
        return obj.members.filter(
            user=request.user, status=ChatMember.Status.ACTIVE
        ).first()

    def get_is_expanded(self, obj):
        return obj.is_expanded

    def get_effective_max_members(self, obj):
        return obj.effective_max_members

    def get_members_count(self, obj):
        # Use annotation from queryset if available (avoid N+1)
        annotated = getattr(obj, "_members_count", None)
        if annotated is not None:
            return annotated
        return obj.members.filter(status=ChatMember.Status.ACTIVE).count()

    def get_chat_type(self, obj):
        """Personal chats have no type; only groups return open/closed."""
        if getattr(obj, "is_personal", False):
            return None
        return obj.chat_type

    def get_invite_link(self, obj):
        """Personal chats and Favorites have no invite link."""
        if getattr(obj, "is_personal", False) or getattr(obj, "is_favorites", False):
            return None
        from django.conf import settings
        base = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        if not base:
            request = self.context.get("request")
            if request:
                base = request.build_absolute_uri("/").rstrip("/")
            else:
                return None
        return f"{base}/chat/join/{obj.slug}?code={obj.verification_code}"

    def get_unread_count(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        membership = self._get_membership(obj)
        if not membership:
            return 0
        if not membership.last_read_at:
            return obj.messages.filter(is_deleted=False).count()
        return obj.messages.filter(
            created_at__gt=membership.last_read_at, is_deleted=False
        ).count()

    def get_is_muted(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        membership = self._get_membership(obj)
        return membership.is_muted if membership else False

    def get_muted_until(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        membership = self._get_membership(obj)
        if not membership or not membership.muted_until:
            return None
        return membership.muted_until.isoformat()

    def get_pin_order(self, obj):
        membership = self._get_membership(obj)
        return membership.pin_order if membership else None

    def get_is_archived(self, obj):
        membership = self._get_membership(obj)
        return membership.is_archived if membership else False

    def get_folder_ids(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        memberships = getattr(obj, "_user_folder_memberships", None)
        if memberships is not None:
            return [str(m.folder_id) for m in memberships]
        return [
            str(fc.folder_id)
            for fc in ChatFolderChat.objects.filter(
                folder__user=request.user, chat=obj
            ).only("folder_id")
        ]

    def get_pending_join_requests_count(self, obj):
        """Number of pending join requests; only for owner and admins, 0 for others."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        if getattr(obj, "is_personal", False) or getattr(obj, "is_favorites", False):
            return 0
        membership = self._get_membership(obj)
        if not membership:
            return 0
        if obj.owner_id != request.user.id and membership.role != ChatMember.Role.ADMIN:
            return 0
        annotated = getattr(obj, "_pending_join_count", None)
        if annotated is not None:
            return annotated
        return obj.members.filter(status=ChatMember.Status.PENDING).count()

    def get_avatar_handle(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_chat_avatar_handle(obj.id)

    def get_avatar_handle_small(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_chat_avatar_handle(obj.id, size="small")

    def get_avatar_handle_medium(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_chat_avatar_handle(obj.id, size="medium")

    def get_background_handle(self, obj):
        if not obj.background:
            return None
        return make_chat_background_handle(obj.id)

    def get_other_member(self, obj):
        """For a personal chat (2 active members) — the other participant."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        # Use already prefetched members (via members__user) to avoid extra query
        try:
            all_members = obj.members.all()
        except Exception:
            return None
        active = [m for m in all_members if m.status == ChatMember.Status.ACTIVE]
        if len(active) != 2:
            return None
        other = next((m.user for m in active if m.user_id != request.user.id), None)
        if not other:
            return None
        return UserSerializer(other, context=self.context).data

    def _other_members_read(self, chat):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        return [
            {"user": UserSerializer(m.user, context=self.context).data, "last_read_at": m.last_read_at}
            for m in ChatMember.objects.filter(chat=chat, status=ChatMember.Status.ACTIVE)
            .exclude(user=request.user)
            .select_related("user")
        ]

    def get_pinned_message(self, obj):
        """First (most recent) pinned-for-all message — backward compat."""
        pins = self._get_all_pinned(obj)
        if pins:
            return pins[0]
        # Fallback: legacy single pinned_message FK
        msg = getattr(obj, "pinned_message", None)
        if msg and not msg.is_deleted:
            ctx = {"request": self.context.get("request"), "other_members_read": self._other_members_read(obj)}
            return MessageSerializer(msg, context=ctx).data
        return None

    def _get_all_pinned(self, obj):
        """All pinned-for-all messages, serialized."""
        pins = (
            ChatPinnedMessage.objects.filter(chat=obj)
            .select_related("message", "message__sender", "message__file", "message__reply_to", "message__reply_to__sender", "message__reply_to__file", "message__forwarded_from", "message__forwarded_from_chat")
            .prefetch_related("message__files", "message__reactions")
            .order_by("-pin_order")
        )
        ctx = {"request": self.context.get("request"), "other_members_read": self._other_members_read(obj)}
        return [
            MessageSerializer(p.message, context=ctx).data
            for p in pins
            if not p.message.is_deleted
        ]

    def get_pinned_messages(self, obj):
        """All pinned-for-all messages (ordered by pin_order desc)."""
        return self._get_all_pinned(obj)

    def get_max_pins(self, obj):
        return obj.max_pins

    def get_my_pinned_messages(self, obj):
        """List of messages pinned by the current user for themselves."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        pins = (
            UserPinnedMessage.objects.filter(chat=obj, user=request.user)
            .select_related("message", "message__sender", "message__file")
            .prefetch_related("message__files", "message__reactions")
            .order_by("-created_at")[:50]
        )
        ctx = {"request": request, "other_members_read": self._other_members_read(obj)}
        return [
            MessageSerializer(p.message, context=ctx).data
            for p in pins
            if not p.message.is_deleted
        ]

    def get_last_message_preview(self, obj):
        """Preview of the last message for the chat list (text up to ~60 chars or type label)."""
        # Use prefetch from queryset if available (avoid N+1)
        prefetched = getattr(obj, "_prefetched_last_message", None)
        if prefetched is not None:
            msg = prefetched[0] if len(prefetched) > 0 else None
        else:
            msg = obj.messages.filter(is_deleted=False).order_by("-created_at").first()
        if not msg:
            return ""
        if getattr(msg, "is_encrypted", False):
            return "Зашифрованное сообщение"
        mime = (msg.file and getattr(msg.file, "mime_type", None)) or ""
        if msg.msg_type == "audio":
            return "(голосовое)"
        if msg.msg_type == "gif":
            return "(GIF)"
        if msg.msg_type == "sticker":
            return "(стикер)"
        if msg.msg_type == "video" or msg.msg_type == "video_circle" or str(mime).startswith("video/"):
            return "(видео)"
        if str(mime).startswith("image/"):
            return "(фото)"
        if msg.msg_type == "file":
            return "(файл)"
        text = (msg.content or "").strip()
        if not text:
            return "(сообщение)"
        return text[:60] + ("…" if len(text) > 60 else "")

    def get_last_message_at(self, obj):
        """Timestamp of the last non-deleted message (for chat list sorting)."""
        at = getattr(obj, "_last_message_at", None)
        return at.isoformat() if at else None

    def _get_last_message_obj(self, obj):
        """Return the last non-deleted message object (if available)."""
        prefetched = getattr(obj, "_prefetched_last_message", None)
        if prefetched is not None:
            return prefetched[0] if len(prefetched) > 0 else None
        return obj.messages.filter(is_deleted=False).order_by("-created_at").first()

    def get_last_message_is_mine(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        msg = self._get_last_message_obj(obj)
        if not msg:
            return False
        return msg.sender_id == request.user.id

    def get_last_message_read_status(self, obj):
        """For last message only: if it's mine, return delivered/read; else null."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        msg = self._get_last_message_obj(obj)
        if not msg or msg.sender_id != request.user.id:
            return None
        ctx = {"request": request, "other_members_read": self._other_members_read(obj)}
        return MessageSerializer(msg, context=ctx).data.get("read_status")

    def validate_title(self, value):
        if value is not None and len(value) > CHAT_TITLE_MAX_LENGTH:
            raise serializers.ValidationError(
                f"Название не должно превышать {CHAT_TITLE_MAX_LENGTH} символов."
            )
        return value

    def validate_description(self, value):
        if value is not None and len(value) > CHAT_DESCRIPTION_MAX_LENGTH:
            raise serializers.ValidationError(
                f"Описание не должно превышать {CHAT_DESCRIPTION_MAX_LENGTH} символов."
            )
        return value or ""


CHAT_TITLE_MAX_LENGTH = 50
CHAT_DESCRIPTION_MAX_LENGTH = 300
MESSAGE_CONTENT_MAX_LENGTH = 4096


class ChatCreateSerializer(serializers.ModelSerializer):
    title = serializers.CharField(max_length=CHAT_TITLE_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, max_length=CHAT_DESCRIPTION_MAX_LENGTH)
    title_icon = serializers.CharField(required=False, allow_blank=True, max_length=16)

    class Meta:
        model = Chat
        fields = ("title", "title_icon", "chat_type", "description")

    def create(self, validated_data):
        from django.db import transaction
        slug = generate_slug()
        while Chat.objects.filter(slug=slug).exists():
            slug = generate_slug()
        validated_data["slug"] = slug
        validated_data["verification_code"] = make_verification_code(slug)
        validated_data["max_members"] = DEFAULT_MAX_MEMBERS
        validated_data["owner"] = self.context["request"].user
        with transaction.atomic():
            chat = super().create(validated_data)
            ChatMember.objects.get_or_create(
                chat=chat,
                user=chat.owner,
                defaults={
                    "role": ChatMember.Role.ADMIN,
                    "status": ChatMember.Status.ACTIVE,
                },
            )
        return chat


class JoinChatSerializer(serializers.Serializer):
    slug = serializers.SlugField()
    code = serializers.CharField(max_length=64)


class ReplyMessageSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the replied-to message (no recursion)."""
    sender = UserSerializer(read_only=True)
    file = FileAttachmentSerializer(read_only=True)

    class Meta:
        model = Message
        fields = ("id", "sender", "sender_display_name", "msg_type", "content", "file", "created_at", "is_deleted")
        read_only_fields = fields


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    file = FileAttachmentSerializer(read_only=True)
    files = FileAttachmentSerializer(read_only=True, many=True)
    reactions = serializers.SerializerMethodField()
    my_reactions = serializers.SerializerMethodField()
    read_status = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    file_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False,
        help_text="Список UUID файлов для прикрепления к сообщению",
    )
    file_id = serializers.UUIDField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text="UUID одного файла для прикрепления к сообщению",
    )
    waveform = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=255),
        required=False,
        allow_null=True,
        max_length=128,
        help_text="Амплитуды для визуализации аудио (0–255, до 128 значений)",
    )
    # Reply — write: UUID, read: nested lightweight serializer
    reply_to_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    reply_to = ReplyMessageSerializer(read_only=True)
    # Forward — read-only nested fields
    forwarded_from = UserSerializer(read_only=True)
    forwarded_from_chat_title = serializers.SerializerMethodField()
    # E2EE (write: int, read: from sender_device.device_id)
    sender_device_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    # Poll: write poll_data when msg_type=poll; read poll_data, poll_results, my_vote
    poll_data = serializers.JSONField(required=False, allow_null=True)
    delete_after_read = serializers.BooleanField(required=False, default=False)
    poll_results = serializers.SerializerMethodField()
    my_vote = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id", "chat", "sender", "sender_display_name", "msg_type", "content", "file", "files",
            "created_at", "edited_at", "is_deleted", "reactions", "my_reactions", "read_status", "read_by",
            "file_ids", "file_id", "waveform", "duration_seconds",
            "reply_to_id", "reply_to",
            "forwarded_from", "forwarded_from_chat_title",
            "is_encrypted", "encrypted_keys", "sender_device_id",
            "link_preview", "expires_at",
            "poll_data", "poll_results", "my_vote",
            "delete_after_read",
        )
        read_only_fields = ("id", "chat", "sender", "sender_display_name", "created_at", "edited_at", "is_deleted", "files", "expires_at", "poll_results", "my_vote")

    def get_read_status(self, obj):
        """For own messages: 'delivered' (1 checkmark) or 'read' (2 checkmarks). Two checkmarks if at least one other member has read it (last_read_at >= created_at)."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated or obj.sender_id != request.user.id:
            return None
        other = self.context.get("other_members_read") or []
        if not other:
            return "delivered"
        try:
            return "read" if any(
                m.get("last_read_at") and m["last_read_at"] >= obj.created_at for m in other
            ) else "delivered"
        except (TypeError, ValueError):
            return "delivered"

    def get_read_by(self, obj):
        """For own messages: list of users who have read this message (last_read_at >= created_at)."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated or obj.sender_id != request.user.id:
            return []
        other = self.context.get("other_members_read") or []
        return [
            m["user"] for m in other
            if m.get("last_read_at") and m["last_read_at"] >= obj.created_at
        ]

    def get_reactions(self, obj):
        """Emoji summary: { "👍": 2, "❤️": 1 }."""
        qs = obj.reactions.values_list("emoji").order_by("emoji")
        counts = {}
        for (emoji,) in qs:
            counts[emoji] = counts.get(emoji, 0) + 1
        return counts

    def get_my_reactions(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        return list(
            obj.reactions.filter(user=request.user).values_list("emoji", flat=True).order_by("emoji")
        )

    def get_forwarded_from_chat_title(self, obj):
        if obj.forwarded_from_chat_id:
            return getattr(obj.forwarded_from_chat, "title", None)
        return None

    def get_poll_results(self, obj):
        if obj.msg_type != "poll" or not obj.poll_data:
            return None
        options = obj.poll_data.get("options") or []
        if not options:
            return [{"count": 0} for _ in options]
        from .models import PollVote
        counts = [0] * len(options)
        for vote in PollVote.objects.filter(message=obj).exclude(option_indices=[]):
            for idx in vote.option_indices:
                if isinstance(idx, int) and 0 <= idx < len(counts):
                    counts[idx] += 1
        return [{"count": c} for c in counts]

    def get_my_vote(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated or obj.msg_type != "poll":
            return None
        if obj.poll_data and obj.poll_data.get("anonymous"):
            return None  # Don't reveal own vote in anonymous polls
        from .models import PollVote
        try:
            vote = PollVote.objects.get(message=obj, user=request.user)
            return vote.option_indices
        except PollVote.DoesNotExist:
            return None

    def validate(self, attrs):
        content = attrs.get("content")
        if content is not None and len(content) > MESSAGE_CONTENT_MAX_LENGTH:
            raise serializers.ValidationError(
                {"content": f"Максимум {MESSAGE_CONTENT_MAX_LENGTH} символов."}
            )
        request = self.context.get("request")
        chat = self.context.get("chat")
        if request and request.user.is_authenticated and chat:
            # Slow mode: owners and admins are exempt
            if getattr(chat, "slow_mode_seconds", 0) and chat.slow_mode_seconds > 0:
                if chat.owner_id != request.user.id:
                    membership = chat.members.filter(
                        user=request.user, status=ChatMember.Status.ACTIVE
                    ).first()
                    if not membership or membership.role != ChatMember.Role.ADMIN:
                        from django.utils import timezone
                        last_msg = (
                            Message.objects.filter(
                                chat=chat, sender=request.user, is_deleted=False
                            )
                            .order_by("-created_at")
                            .values("created_at")
                            .first()
                        )
                        if last_msg:
                            elapsed = (timezone.now() - last_msg["created_at"]).total_seconds()
                            if elapsed < chat.slow_mode_seconds:
                                retry = int(chat.slow_mode_seconds - elapsed)
                                raise serializers.ValidationError(
                                    {"detail": f"Slow mode: подождите {retry} сек.", "retry_after": retry}
                                )
            msg_type = attrs.get("msg_type", "")
            if msg_type == "video_circle" and not can_send_video_circle_today(request.user):
                raise PermissionDenied(
                    detail="Дневной лимит видео-кружков (3) исчерпан. Оформите подписку для безлимита.",
                )
            if msg_type == "poll":
                chat = self.context.get("chat")
                if chat and (chat.is_personal or chat.is_favorites):
                    raise serializers.ValidationError(
                        {"msg_type": "Опросы можно создавать только в группах и каналах."}
                    )
                if not can_create_poll(request.user):
                    raise PlanRestrictionError("Опросы и викторины доступны по подписке. Оформите подписку в настройках.")
        return attrs

    def create(self, validated_data):
        file_id = validated_data.pop("file_id", None)
        file_ids = validated_data.pop("file_ids", None) or []
        reply_to_id = validated_data.pop("reply_to_id", None)
        sender_device_id = validated_data.pop("sender_device_id", None)
        delete_after_read = validated_data.pop("delete_after_read", False)
        if reply_to_id:
            validated_data["reply_to_id"] = reply_to_id
        if sender_device_id is not None:
            from apps.e2ee.models import Device
            try:
                device = Device.objects.get(user=validated_data["sender"], device_id=sender_device_id, is_active=True)
                validated_data["sender_device"] = device
            except Device.DoesNotExist:
                pass
        if delete_after_read:
            validated_data["delete_after_read"] = True
        msg = super().create(validated_data)
        if file_id:
            from apps.files.models import FileAttachment
            request = self.context.get("request")
            attachments = FileAttachment.objects.filter(id=file_id)
            if request and request.user and request.user.is_authenticated:
                attachments = attachments.filter(uploader=request.user)
            att = attachments.first()
            if att:
                msg.file = att
                msg.save(update_fields=["file"])
        if file_ids:
            from apps.files.models import FileAttachment
            attachments = FileAttachment.objects.filter(id__in=file_ids)
            request = self.context.get("request")
            if request and request.user and request.user.is_authenticated:
                attachments = attachments.filter(uploader=request.user)
            msg.files.set(attachments)
            # For compatibility: if there's a single file and file FK is not set, use the first one
            if not msg.file and attachments.exists():
                msg.file = attachments.first()
                msg.save(update_fields=["file"])
        # Link preview for text messages with URL (skip for encrypted)
        if msg.msg_type == "text" and msg.content and not msg.is_encrypted:
            from apps.chats.link_preview import extract_and_fetch_link_preview
            preview = extract_and_fetch_link_preview(msg.content, is_encrypted=False)
            if preview:
                msg.link_preview = preview
                msg.save(update_fields=["link_preview"])
        return msg

    def to_representation(self, instance):
        """Return nested file objects for reading, accept UUIDs for writing."""
        data = super().to_representation(instance)
        if instance.sender_device:
            data["sender_device_id"] = instance.sender_device.device_id
        from apps.files.serializers import FileAttachmentSerializer
        if instance.file:
            data["file"] = FileAttachmentSerializer(instance.file, context=self.context).data
        # Always return a files array
        all_files = instance.files.all()
        if all_files.exists():
            data["files"] = FileAttachmentSerializer(all_files, many=True, context=self.context).data
        else:
            # For backward compatibility: if there's a single file, duplicate it into files
            data["files"] = [data["file"]] if instance.file else []
        return data


class ScheduledMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduledMessage
        fields = (
            "id", "chat", "content", "scheduled_at",
            "recurrence", "recurrence_time", "recurrence_weekday", "created_at",
        )
        read_only_fields = ("id", "chat", "created_at")

    def validate(self, attrs):
        recurrence = attrs.get("recurrence", ScheduledMessage.Recurrence.NONE)
        if recurrence != ScheduledMessage.Recurrence.NONE:
            if not attrs.get("recurrence_time"):
                raise serializers.ValidationError({"recurrence_time": "Укажите время для повторения."})
            if recurrence == ScheduledMessage.Recurrence.WEEKLY and attrs.get("recurrence_weekday") is None:
                raise serializers.ValidationError({"recurrence_weekday": "Укажите день недели (0=пн, 6=вс)."})
        return attrs


# --- Channel serializers ---

CHANNEL_TITLE_MAX_LENGTH = 50
CHANNEL_DESCRIPTION_MAX_LENGTH = 300


def _validate_channel_username(value, exclude_channel=None, required=False):
    """Validate channel username format and uniqueness (users + channels). required=True: empty is invalid."""
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise serializers.ValidationError("Укажите username канала (обязательное поле).")
        return None
    from apps.users.serializers import validate_username_format
    from .utils import is_username_available

    normalized = validate_username_format(value)
    if not is_username_available(normalized, exclude_channel=exclude_channel):
        raise serializers.ValidationError("Этот юзернейм уже занят (пользователем или каналом).")
    return normalized


class ChannelMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ChannelMember
        fields = ("id", "user", "role", "status", "joined_at")


class ChannelSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    members_count = serializers.SerializerMethodField()
    invite_link = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    avatar_handle = serializers.SerializerMethodField()
    avatar_handle_small = serializers.SerializerMethodField()
    avatar_handle_medium = serializers.SerializerMethodField()
    last_post_at = serializers.SerializerMethodField()
    last_post_preview = serializers.SerializerMethodField()
    username = serializers.CharField(required=False, allow_blank=False, allow_null=True, max_length=30)
    is_muted = serializers.SerializerMethodField()

    def validate_username(self, value):
        if value is None:
            return value
        return _validate_channel_username(value, exclude_channel=self.instance, required=False)

    class Meta:
        model = Channel
        fields = (
            "id", "title", "title_icon", "description", "slug", "username", "is_public", "comments_enabled",
            "owner", "members_count", "invite_link", "my_role", "avatar_handle", "avatar_handle_small", "avatar_handle_medium",
            "is_active", "created_at", "last_post_at", "last_post_preview", "is_muted",
        )

    def _get_membership(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        return obj.members.filter(user=request.user, status=ChannelMember.Status.ACTIVE).first()

    def get_members_count(self, obj):
        return obj.members.filter(status=ChannelMember.Status.ACTIVE).count()

    def get_invite_link(self, obj):
        base = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        if not base and self.context.get("request"):
            base = self.context["request"].build_absolute_uri("/").rstrip("/")
        if not base:
            return None
        if obj.username:
            suffix = f"?code={obj.verification_code}" if not obj.is_public else ""
            return f"{base}/c/{obj.username}{suffix}"
        return f"{base}/channel/join/{obj.slug}?code={obj.verification_code}"

    def get_my_role(self, obj):
        m = self._get_membership(obj)
        return m.role if m else None

    def get_is_muted(self, obj):
        m = self._get_membership(obj)
        return bool(getattr(m, "is_muted", False)) if m else False

    def get_avatar_handle(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_channel_avatar_handle(obj.id)

    def get_avatar_handle_small(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_channel_avatar_handle(obj.id, size="small")

    def get_avatar_handle_medium(self, obj):
        if not obj.avatar:
            return None
        from apps.files.protected_media import _protected_media_file_exists
        if not _protected_media_file_exists(obj.avatar.name):
            return None
        return make_channel_avatar_handle(obj.id, size="medium")

    def get_last_post_at(self, obj):
        last_post = obj.posts.filter(is_deleted=False).order_by("-created_at").values_list("created_at", flat=True).first()
        return last_post.isoformat() if last_post else None

    def get_last_post_preview(self, obj):
        """Preview of last post for channel list (like last_message_preview for chats)."""
        post = obj.posts.filter(is_deleted=False).order_by("-created_at").select_related("file").first()
        if not post:
            return ""
        if post.msg_type == "audio":
            return "(голосовое)"
        if post.msg_type == "gif":
            return "(GIF)"
        if post.msg_type == "sticker":
            return "(стикер)"
        if post.msg_type == "video" or post.msg_type == "video_circle":
            return "(видео)"
        if post.file and getattr(post.file, "mime_type", "").startswith("video/"):
            return "(видео)"
        if post.file and getattr(post.file, "mime_type", "").startswith("image/"):
            return "(фото)"
        if post.msg_type == "file":
            return "(файл)"
        text = (post.content or "").strip()
        if not text:
            return "(сообщение)"
        return text[:60] + ("…" if len(text) > 60 else "")


class ChannelCreateSerializer(serializers.ModelSerializer):
    title = serializers.CharField(max_length=CHANNEL_TITLE_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, max_length=CHANNEL_DESCRIPTION_MAX_LENGTH)
    is_public = serializers.BooleanField(default=True)
    title_icon = serializers.CharField(required=False, allow_blank=True, max_length=16)
    username = serializers.CharField(required=True, allow_blank=False, max_length=30)

    class Meta:
        model = Channel
        fields = ("title", "title_icon", "description", "is_public", "username")

    def validate_username(self, value):
        return _validate_channel_username(value, exclude_channel=None, required=True)

    def create(self, validated_data):
        from django.db import transaction
        from .utils import generate_slug, make_verification_code
        username = validated_data.pop("username").strip()
        slug = generate_slug()
        while Channel.objects.filter(slug=slug).exists():
            slug = generate_slug()
        validated_data["slug"] = slug
        validated_data["verification_code"] = make_verification_code(slug)
        validated_data["owner"] = self.context["request"].user
        validated_data["username"] = username
        with transaction.atomic():
            channel = super().create(validated_data)
            ChannelMember.objects.create(
                channel=channel,
                user=channel.owner,
                role=ChannelMember.Role.OWNER,
                status=ChannelMember.Status.ACTIVE,
            )
        return channel


class JoinChannelSerializer(serializers.Serializer):
    """Join by slug+code or by username (+ code for private channels)."""
    slug = serializers.SlugField(required=False, allow_blank=True)
    username = serializers.CharField(required=False, allow_blank=True, max_length=30)
    code = serializers.CharField(max_length=64)

    def validate(self, attrs):
        slug = (attrs.get("slug") or "").strip()
        username = (attrs.get("username") or "").strip()
        if not slug and not username:
            raise serializers.ValidationError({"slug": "Укажите slug или username."})
        if slug and username:
            raise serializers.ValidationError({"slug": "Укажите только slug или только username."})
        attrs["_slug"] = slug
        attrs["_username"] = username if username else None
        return attrs


class ReplyCommentSerializer(serializers.ModelSerializer):
    """Краткий вид комментария для reply_to."""
    author = UserSerializer(read_only=True)
    file = FileAttachmentSerializer(read_only=True)

    class Meta:
        model = ChannelPostComment
        fields = ("id", "author", "msg_type", "content", "file", "created_at", "is_deleted")
        read_only_fields = fields


class ChannelPostCommentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    file = FileAttachmentSerializer(read_only=True)
    files = FileAttachmentSerializer(read_only=True, many=True)
    reply_to = ReplyCommentSerializer(read_only=True)
    file_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    file_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    reply_to_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    waveform = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=255), required=False, allow_null=True, max_length=128,
    )

    class Meta:
        model = ChannelPostComment
        fields = (
            "id", "post", "author", "msg_type", "content", "file", "files",
            "file_id", "file_ids", "reply_to_id", "reply_to",
            "created_at", "edited_at", "is_deleted", "waveform",
        )
        read_only_fields = ("id", "post", "author", "created_at", "edited_at", "is_deleted", "files")

    def create(self, validated_data):
        file_id = validated_data.pop("file_id", None)
        file_ids = validated_data.pop("file_ids", None) or []
        reply_to_id = validated_data.pop("reply_to_id", None)
        if reply_to_id:
            validated_data["reply_to_id"] = reply_to_id
        comment = super().create(validated_data)
        if file_id:
            from apps.files.models import FileAttachment
            request = self.context.get("request")
            att = FileAttachment.objects.filter(id=file_id)
            if request and request.user.is_authenticated:
                att = att.filter(uploader=request.user)
            att = att.first()
            if att:
                comment.file = att
                comment.save(update_fields=["file"])
        if file_ids:
            from apps.files.models import FileAttachment
            atts = FileAttachment.objects.filter(id__in=file_ids)
            if request := self.context.get("request"):
                if request.user.is_authenticated:
                    atts = atts.filter(uploader=request.user)
            comment.files.set(atts)
            if not comment.file and atts.exists():
                comment.file = atts.first()
                comment.save(update_fields=["file"])
        return comment

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.file:
            data["file"] = FileAttachmentSerializer(instance.file, context=self.context).data
        data["files"] = FileAttachmentSerializer(instance.files.all(), many=True, context=self.context).data
        return data


class ChannelPostSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    file = FileAttachmentSerializer(read_only=True)
    files = FileAttachmentSerializer(read_only=True, many=True)
    reactions = serializers.SerializerMethodField()
    my_reactions = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()
    views_count = serializers.SerializerMethodField()
    forwarded_from = UserSerializer(read_only=True)
    forwarded_from_chat_title = serializers.SerializerMethodField()
    file_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    file_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    waveform = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=255), required=False, allow_null=True, max_length=128,
    )
    sender_device_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = ChannelPost
        fields = (
            "id", "channel", "author", "msg_type", "content", "file", "files",
            "created_at", "edited_at", "is_deleted", "reactions", "my_reactions", "comments_count", "views_count",
            "file_id", "file_ids", "waveform",
            "forwarded_from", "forwarded_from_chat_title",
            "is_encrypted", "encrypted_keys", "sender_device_id",
        )
        read_only_fields = ("id", "channel", "author", "created_at", "edited_at", "is_deleted", "files")

    def get_reactions(self, obj):
        qs = obj.reactions.values_list("emoji").order_by("emoji")
        counts = {}
        for (emoji,) in qs:
            counts[emoji] = counts.get(emoji, 0) + 1
        return counts

    def get_my_reactions(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        return list(obj.reactions.filter(user=request.user).values_list("emoji", flat=True).order_by("emoji"))

    def get_comments_count(self, obj):
        return obj.comments.filter(is_deleted=False).count()

    def get_views_count(self, obj):
        annotated = getattr(obj, "_views_count", None)
        if annotated is not None:
            return int(annotated)
        try:
            return obj.views.count()
        except Exception:
            return 0

    def get_forwarded_from_chat_title(self, obj):
        return getattr(obj.forwarded_from_chat, "title", None) if obj.forwarded_from_chat_id else None

    def create(self, validated_data):
        file_id = validated_data.pop("file_id", None)
        file_ids = validated_data.pop("file_ids", None) or []
        sender_device_id = validated_data.pop("sender_device_id", None)
        if sender_device_id is not None and validated_data.get("author"):
            from apps.e2ee.models import Device
            try:
                device = Device.objects.get(user=validated_data["author"], device_id=sender_device_id, is_active=True)
                validated_data["sender_device"] = device
            except Device.DoesNotExist:
                pass
        post = super().create(validated_data)
        if file_id:
            from apps.files.models import FileAttachment
            request = self.context.get("request")
            att = FileAttachment.objects.filter(id=file_id)
            if request and request.user.is_authenticated:
                att = att.filter(uploader=request.user)
            att = att.first()
            if att:
                post.file = att
                post.save(update_fields=["file"])
        if file_ids:
            from apps.files.models import FileAttachment
            atts = FileAttachment.objects.filter(id__in=file_ids)
            if request := self.context.get("request"):
                if request.user.is_authenticated:
                    atts = atts.filter(uploader=request.user)
            post.files.set(atts)
            if not post.file and atts.exists():
                post.file = atts.first()
                post.save(update_fields=["file"])
        return post

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.sender_device:
            data["sender_device_id"] = instance.sender_device.device_id
        if instance.file:
            data["file"] = FileAttachmentSerializer(instance.file, context=self.context).data
        data["files"] = FileAttachmentSerializer(instance.files.all(), many=True, context=self.context).data
        return data
