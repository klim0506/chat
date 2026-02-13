import re
from rest_framework import serializers
from .models import User, UserAvatar

USERNAME_REGEX = re.compile(r"^[a-z0-9_]{3,30}$")


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

    class Meta:
        model = User
        fields = (
            "id", "phone", "username", "telegram_username", "display_name",
            "avatar", "avatar_url", "avatars", "referral_code", "stars",
            "is_online", "last_seen_display", "show_last_seen",
        )
        read_only_fields = ("id", "phone", "telegram_username", "referral_code", "stars", "is_online", "last_seen_display")

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
        avatars = UserAvatar.objects.filter(user=obj).order_by("order", "id")
        request = self.context.get("request")
        request_uri = getattr(request, "build_absolute_uri", None) if request else None
        result = []
        for a in avatars:
            url = a.image.url
            if request_uri:
                url = request_uri(url)
            result.append({"id": a.id, "url": url, "order": a.order})
        if not result and obj.avatar:
            url = obj.avatar.url
            if request_uri:
                url = request_uri(url)
            result.append({"id": "legacy", "url": url, "order": 0})
        return result
