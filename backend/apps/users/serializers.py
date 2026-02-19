import re
from rest_framework import serializers
from apps.files.protected_media import make_protected_media_url
from .models import User, UserAvatar

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
    method = serializers.ChoiceField(choices=["sms", "telegram"], required=False)  # при "sms" — только SMS, иначе сначала Telegram


class VerifyCodeSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(max_length=6, min_length=6)
    username = serializers.CharField(max_length=30, required=False, allow_blank=True)


class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()
    avatars = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen_display = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "phone", "username", "telegram_username", "display_name",
            "avatar", "avatar_url", "avatars", "referral_code", "stars",
            "is_online", "last_seen_display", "show_last_seen", "show_phone",
            "dm_privacy", "add_to_group_privacy",
        )
        read_only_fields = ("id", "phone", "telegram_username", "referral_code", "stars", "is_online", "last_seen_display")

    def get_phone(self, obj):
        """Return phone only when show_phone or viewer is the user herself."""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated and request.user.pk == obj.pk:
            return obj.phone
        if obj.show_phone:
            return obj.phone
        return None

    def get_is_online(self, obj):
        from .online import is_online
        return is_online(str(obj.id))

    def get_last_seen_display(self, obj):
        """Return last_seen ISO string or 'recently' if user hides it."""
        from .online import is_online
        if is_online(str(obj.id)):
            return None  # online right now
        if not obj.show_last_seen:
            return "recently"
        if obj.last_seen:
            return obj.last_seen.isoformat()
        return None

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

    def get_avatar_url(self, obj):
        request = self.context.get("request")
        return obj.get_avatar_url(request)

    def get_avatars(self, obj):
        request = self.context.get("request")
        avatars = UserAvatar.objects.filter(user=obj).order_by("order", "id")
        result = []
        for a in avatars:
            try:
                if a.image:
                    url = make_protected_media_url(a.image.name, request)
                    if url:
                        result.append({"id": a.id, "url": url, "order": a.order})
            except (ValueError, OSError):
                continue
        if not result and obj.avatar:
            try:
                url = make_protected_media_url(obj.avatar.name, request)
                if url:
                    result.append({"id": "legacy", "url": url, "order": 0})
            except (ValueError, OSError):
                pass
        return result
