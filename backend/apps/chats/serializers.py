from rest_framework import serializers
from .models import Chat, ChatMember, Message, MessageReaction, ScheduledMessage, UserPinnedMessage, REACTION_EMOJIS, DEFAULT_MAX_MEMBERS
from apps.users.serializers import UserSerializer
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
    is_expanded = serializers.SerializerMethodField()
    expanded_until = serializers.DateTimeField(read_only=True)
    effective_max_members = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    background_url = serializers.SerializerMethodField()
    other_member = serializers.SerializerMethodField()
    pinned_message = serializers.SerializerMethodField()
    my_pinned_messages = serializers.SerializerMethodField()
    last_message_preview = serializers.SerializerMethodField()

    class Meta:
        model = Chat
        fields = (
            "id", "title", "description", "slug", "chat_type", "is_personal", "is_favorites", "max_members", "owner",
            "members_count", "invite_link", "is_active", "created_at",
            "unread_count", "is_muted",
            "is_expanded", "expanded_until", "effective_max_members",
            "avatar_url", "background_url", "other_member",
            "pinned_message", "my_pinned_messages",
            "last_message_preview",
        )

    def get_is_expanded(self, obj):
        return obj.is_expanded

    def get_effective_max_members(self, obj):
        return obj.effective_max_members

    def get_members_count(self, obj):
        return obj.members.filter(status=ChatMember.Status.ACTIVE).count()

    def get_chat_type(self, obj):
        """У личного чата нет типа; только группы возвращают open/closed."""
        if getattr(obj, "is_personal", False):
            return None
        return obj.chat_type

    def get_invite_link(self, obj):
        """У личного чата и у «Избранное» нет ссылки-приглашения."""
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
        membership = obj.members.filter(
            user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return 0
        if not membership.last_read_at:
            # Никогда не открывал — все сообщения непрочитаны
            return obj.messages.filter(is_deleted=False).count()
        return obj.messages.filter(
            created_at__gt=membership.last_read_at, is_deleted=False
        ).count()

    def get_is_muted(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        membership = obj.members.filter(
            user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        return membership.is_muted if membership else False

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.avatar.url)
        return obj.avatar.url

    def get_background_url(self, obj):
        if not obj.background:
            return None
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.background.url)
        return obj.background.url

    def get_other_member(self, obj):
        """Для личного чата (2 активных участника) — тот, с кем ведётся переписка."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        active = list(obj.members.filter(status=ChatMember.Status.ACTIVE))
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
        """Сообщение, закреплённое для всех в чате."""
        msg = getattr(obj, "pinned_message", None)
        if not msg or msg.is_deleted:
            return None
        ctx = {"request": self.context.get("request"), "other_members_read": self._other_members_read(obj)}
        return MessageSerializer(msg, context=ctx).data

    def get_my_pinned_messages(self, obj):
        """Список сообщений, закреплённых текущим пользователем для себя."""
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
        """Превью последнего сообщения для списка чатов (текст до ~60 символов или метка типа)."""
        msg = obj.messages.filter(is_deleted=False).order_by("-created_at").first()
        if not msg:
            return ""
        mime = (msg.file and getattr(msg.file, "mime_type", None)) or ""
        if msg.msg_type == "video" or msg.msg_type == "video_circle" or str(mime).startswith("video/"):
            return "(видео)"
        if msg.msg_type == "audio":
            return "(голосовое)"
        if str(mime).startswith("image/"):
            return "(фото)"
        if msg.msg_type == "file":
            return "(файл)"
        text = (msg.content or "").strip()
        if not text:
            return "(сообщение)"
        return text[:60] + ("…" if len(text) > 60 else "")

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


class ChatCreateSerializer(serializers.ModelSerializer):
    title = serializers.CharField(max_length=CHAT_TITLE_MAX_LENGTH)
    description = serializers.CharField(required=False, allow_blank=True, max_length=CHAT_DESCRIPTION_MAX_LENGTH)

    class Meta:
        model = Chat
        fields = ("title", "chat_type", "description")

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


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    reactions = serializers.SerializerMethodField()
    my_reactions = serializers.SerializerMethodField()
    read_status = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    file_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False,
        help_text="Список UUID файлов для прикрепления к сообщению",
    )
    waveform = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=255),
        required=False,
        allow_null=True,
        max_length=128,
        help_text="Амплитуды для визуализации аудио (0–255, до 128 значений)",
    )

    class Meta:
        model = Message
        fields = (
            "id", "chat", "sender", "msg_type", "content", "file", "files",
            "created_at", "edited_at", "is_deleted", "reactions", "my_reactions", "read_status", "read_by",
            "file_ids", "waveform",
        )
        read_only_fields = ("id", "chat", "sender", "created_at", "edited_at", "is_deleted", "files")

    def get_read_status(self, obj):
        """Для своих сообщений: 'delivered' (1 галочка) или 'read' (2 галочки). Две галочки — если хотя бы один другой участник прочитал (last_read_at >= created_at)."""
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
        """Для своих сообщений: список пользователей, которые прочитали это сообщение (last_read_at >= created_at)."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated or obj.sender_id != request.user.id:
            return []
        other = self.context.get("other_members_read") or []
        return [
            m["user"] for m in other
            if m.get("last_read_at") and m["last_read_at"] >= obj.created_at
        ]

    def get_reactions(self, obj):
        """Сводка по эмодзи: { "👍": 2, "❤️": 1 }."""
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

    def create(self, validated_data):
        file_ids = validated_data.pop("file_ids", None) or []
        msg = super().create(validated_data)
        if file_ids:
            from apps.files.models import FileAttachment
            attachments = FileAttachment.objects.filter(id__in=file_ids)
            request = self.context.get("request")
            if request and request.user and request.user.is_authenticated:
                attachments = attachments.filter(uploader=request.user)
            msg.files.set(attachments)
            # Для совместимости: если есть единственный файл и file не задан, ставим первый
            if not msg.file and attachments.exists():
                msg.file = attachments.first()
                msg.save(update_fields=["file"])
        return msg

    def to_representation(self, instance):
        """Return nested file objects for reading, accept UUIDs for writing."""
        data = super().to_representation(instance)
        from apps.files.serializers import FileAttachmentSerializer
        if instance.file:
            data["file"] = FileAttachmentSerializer(instance.file, context=self.context).data
        # Всегда возвращаем массив files
        all_files = instance.files.all()
        if all_files.exists():
            data["files"] = FileAttachmentSerializer(all_files, many=True, context=self.context).data
        else:
            # Для обратной совместимости: если есть одиночный file, дублируем в files
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
