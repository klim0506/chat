"""Serializers for chat folders."""
from uuid import UUID
from rest_framework import serializers
from .models import ChatFolder, ChatFolderChat, ChatMember


class ChatFolderSerializer(serializers.ModelSerializer):
    chat_ids = serializers.ListField(
        child=serializers.CharField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = ChatFolder
        fields = ("id", "name", "emoji", "color", "position", "created_at", "chat_ids")
        read_only_fields = ("id", "created_at")

    def validate_chat_ids(self, value):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not value:
            return []

        cleaned: list[UUID] = []
        seen: set[UUID] = set()
        for raw in value:
            try:
                chat_id = UUID(str(raw))
            except (TypeError, ValueError):
                raise serializers.ValidationError("Invalid chat id.")
            if chat_id in seen:
                continue
            seen.add(chat_id)
            cleaned.append(chat_id)

        allowed_ids = set(
            ChatMember.objects.filter(
                user=user,
                status=ChatMember.Status.ACTIVE,
                chat_id__in=cleaned,
            ).values_list("chat_id", flat=True)
        )
        if len(allowed_ids) != len(cleaned):
            raise serializers.ValidationError("Some chats are unavailable.")
        return cleaned

    def create(self, validated_data):
        chat_ids = validated_data.pop("chat_ids", [])
        user = validated_data["user"]
        last_position = (
            ChatFolder.objects.filter(user=user)
            .order_by("-position")
            .values_list("position", flat=True)
            .first()
        )
        if not validated_data.get("position"):
            validated_data["position"] = 0 if last_position is None else last_position + 1

        folder = ChatFolder.objects.create(**validated_data)
        if chat_ids:
            ChatFolderChat.objects.bulk_create(
                [ChatFolderChat(folder=folder, chat_id=chat_id) for chat_id in chat_ids],
                ignore_conflicts=True,
            )
        return folder
