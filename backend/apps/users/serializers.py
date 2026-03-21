import re
from rest_framework import serializers
from apps.files.protected_media import make_protected_media_url
from .models import User, UserAvatar, Contact

USERNAME_REGEX = re.compile(r"^[A-Za-z0-9_]{3,30}$")


def normalize_username(value: str) -> str:
    return (value or "").strip().lower()


def validate_username_format(value: str) -> str:
    normalized = normalize_username(value)
    if not normalized:
        raise serializers.ValidationError("Юзернейм не может быть пустым.")
    if not USERNAME_REGEX.match(normalized):
        raise serializers.ValidationError(
            "Только латиница (a-z), цифры и подчёркивание, от 3 до 30 символов."
        )
    return normalized


class SendCodeSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    method = serializers.ChoiceField(
        choices=["sms", "telegram", "pingy"],
        required=False,
    )  # "sms" — SMS only; "telegram" — Telegram only; "pingy" — Pingy app only; default: Pingy → Telegram → SMS
    reuse_existing = serializers.BooleanField(required=False, default=False)


class VerifyCodeSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(max_length=6, min_length=6)
    username = serializers.CharField(max_length=30, required=False, allow_blank=True)


class UserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    avatar_handle = serializers.SerializerMethodField()
    avatar_handle_small = serializers.SerializerMethodField()
    avatar_handle_medium = serializers.SerializerMethodField()
    avatars = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen_display = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    is_staff = serializers.SerializerMethodField()
    local_display_name = serializers.SerializerMethodField()
    personal_channel = serializers.SerializerMethodField()
    personal_channel_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = User
        fields = (
            "id", "short_id", "phone", "username", "telegram_username", "display_name", "bio", "status_emoji", "birthday", "birthday_hide_year", "local_display_name",
            "avatar", "avatar_handle", "avatar_handle_small", "avatar_handle_medium", "avatars", "referral_code", "stars",
            "is_online", "last_seen_display", "show_last_seen", "show_phone",
            "dm_privacy", "add_to_group_privacy", "is_staff",
            "personal_channel", "personal_channel_id",
        )
        read_only_fields = ("id", "short_id", "phone", "telegram_username", "referral_code", "stars", "is_online", "last_seen_display")

    def get_local_display_name(self, obj):
        """Имя из контактов владельца — только для текущего пользователя."""
        request = self.context.get("request")
        if not request or not request.user or not request.user.is_authenticated or request.user.pk == obj.pk:
            return None
        contact = Contact.objects.filter(owner=request.user, contact_user=obj).first()
        return contact.local_name if contact else None

    def get_personal_channel(self, obj):
        """Канал, который пользователь вручную добавил в профиль (только для отображения)."""
        ch = getattr(obj, "personal_channel", None)
        if ch is None:
            return None
        return {
            "id": str(ch.id),
            "title": ch.title,
            "title_icon": ch.title_icon or "",
            "username": ch.username,
            "description": ch.description or "",
        }

    def validate_personal_channel_id(self, value):
        """Только свой канал можно привязать к профилю."""
        if value is None:
            return value
        from apps.chats.models import Channel
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Не авторизован.")
        if not Channel.objects.filter(id=value, owner_id=request.user.id, is_active=True).exists():
            raise serializers.ValidationError("Можно привязать только свой канал.")
        return value

    def update(self, instance, validated_data):
        channel_id = validated_data.pop("personal_channel_id", None)
        super().update(instance, validated_data)
        if "personal_channel_id" in self.initial_data:
            instance.personal_channel_id = channel_id
            instance.save(update_fields=["personal_channel"])
        return instance

    def _can_see_phone_or_last_seen(self, obj, field_value):
        """Check if viewer can see phone/last_seen based on privacy (everyone|nobody|contacts)."""
        request = self.context.get("request")
        if not request or not request.user or not request.user.is_authenticated:
            return False
        if request.user.pk == obj.pk:
            return True
        if field_value == "everyone":
            return True
        if field_value == "nobody":
            return False
        if field_value == "contacts":
            return Contact.objects.filter(owner=obj, contact_user=request.user).exists()
        return bool(field_value)  # legacy bool: True = everyone

    def get_phone(self, obj):
        """Return phone only when show_phone allows it for the viewer."""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated and request.user.pk == obj.pk:
            return obj.phone
        if self._can_see_phone_or_last_seen(obj, getattr(obj, "show_phone", True)):
            return obj.phone
        return None

    def get_is_staff(self, obj):
        """Return is_staff only when viewing own profile (for admin dashboard link)."""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated and request.user.pk == obj.pk:
            return obj.is_staff
        return None

    def get_is_online(self, obj):
        from .online import is_online
        return is_online(str(obj.id))

    def get_last_seen_display(self, obj):
        """Return last_seen ISO string or 'recently' if user hides it from viewer."""
        from .online import is_online
        if is_online(str(obj.id)):
            return None  # online right now
        if not self._can_see_phone_or_last_seen(obj, getattr(obj, "show_last_seen", "everyone")):
            return "recently"
        if obj.last_seen:
            return obj.last_seen.isoformat()
        return None

    def validate(self, attrs):
        from datetime import date
        from rest_framework.exceptions import PermissionDenied
        from apps.payments.plan_limits import can_use_privacy_settings
        privacy_fields = ("show_last_seen", "show_phone", "dm_privacy", "add_to_group_privacy")
        if any(f in attrs for f in privacy_fields):
            request = self.context.get("request")
            if request and request.user and not can_use_privacy_settings(request.user):
                raise PermissionDenied(
                    "Настройки конфиденциальности доступны по подписке. Оформите подписку в разделе «Премиум»."
                )
        if attrs.get("birthday_hide_year") and attrs.get("birthday"):
            b = attrs["birthday"]
            if hasattr(b, "year"):
                attrs["birthday"] = date(2000, b.month, b.day)
            elif isinstance(b, str) and len(b) >= 10:
                # "YYYY-MM-DD" or "MM-DD" (we use 2000 for MM-DD)
                parts = b.split("-")
                if len(parts) == 3:
                    try:
                        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
                        attrs["birthday"] = date(2000, m, d)
                    except (ValueError, TypeError):
                        pass
        return attrs

    def validate_bio(self, value):
        if not value:
            return value
        from apps.payments.plan_limits import get_max_bio_length
        user = self.instance or (self.context.get("request") and self.context["request"].user)
        if user:
            limit = get_max_bio_length(user)
            if len(value) > limit:
                raise serializers.ValidationError(
                    f"Для бесплатного аккаунта «О себе» — до {limit} символов. Оформите подписку для расширенного био."
                )
        return value

    def validate_username(self, value):
        if value is None or (isinstance(value, str) and not value.strip()):
            return value
        normalized = validate_username_format(value)
        qs = User.objects.filter(username__iexact=normalized)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Этот юзернейм уже занят.")
        return normalized

    def get_avatar_handle(self, obj):
        request = self.context.get("request")
        return obj.get_avatar_url(request)

    def get_avatar(self, obj):
        request = self.context.get("request")
        return obj.get_avatar_url(request)

    def get_avatar_handle_small(self, obj):
        request = self.context.get("request")
        return obj.get_avatar_url(request, size="small")

    def get_avatar_handle_medium(self, obj):
        request = self.context.get("request")
        return obj.get_avatar_url(request, size="medium")

    def get_avatars(self, obj):
        request = self.context.get("request")
        avatars = UserAvatar.objects.filter(user=obj).order_by("order", "id")
        result = []
        for a in avatars:
            try:
                if a.image:
                    from apps.files.access_handles import make_user_gallery_avatar_handle
                    from apps.files.protected_media import _protected_media_file_exists
                    if not _protected_media_file_exists(a.image.name):
                        continue
                    access_handle = make_user_gallery_avatar_handle(a.id)
                    access_handle_small = make_user_gallery_avatar_handle(a.id, size="small")
                    access_handle_medium = make_user_gallery_avatar_handle(a.id, size="medium")
                    if access_handle:
                        result.append(
                            {
                                "id": a.id,
                                "access_handle": access_handle,
                                "access_handle_small": access_handle_small,
                                "access_handle_medium": access_handle_medium,
                                "order": a.order,
                            }
                        )
            except (ValueError, OSError):
                continue
        if not result and obj.avatar:
            try:
                access_handle = obj.get_avatar_url(request)
                access_handle_small = obj.get_avatar_url(request, size="small")
                access_handle_medium = obj.get_avatar_url(request, size="medium")
                if access_handle:
                    result.append(
                        {
                            "id": "legacy",
                            "access_handle": access_handle,
                            "access_handle_small": access_handle_small,
                            "access_handle_medium": access_handle_medium,
                            "order": 0,
                        }
                    )
            except (ValueError, OSError):
                pass
        return result


class ContactSerializer(serializers.ModelSerializer):
    contact_user = UserSerializer(read_only=True)

    class Meta:
        model = Contact
        fields = ("id", "contact_user", "local_name", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ContactCreateSerializer(serializers.ModelSerializer):
    user_id = serializers.UUIDField(write_only=True)
    local_name = serializers.CharField(max_length=255)

    class Meta:
        model = Contact
        fields = ("user_id", "local_name")

    def validate_user_id(self, value):
        if value == self.context["request"].user.pk:
            raise serializers.ValidationError("Нельзя добавить себя в контакты.")
        return value

    def create(self, validated_data):
        user_id = validated_data.pop("user_id")
        user = User.objects.get(pk=user_id)
        contact, _ = Contact.objects.update_or_create(
            owner=self.context["request"].user,
            contact_user=user,
            defaults={"local_name": validated_data["local_name"]},
        )
        return contact
