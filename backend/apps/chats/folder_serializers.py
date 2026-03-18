"""Serializers for chat folders."""
from rest_framework import serializers
from .models import ChatFolder


class ChatFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatFolder
        fields = ("id", "name", "emoji", "color", "position", "created_at")
        read_only_fields = ("id", "created_at")
