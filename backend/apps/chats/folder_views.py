"""Views for user chat folders (Telegram-style)."""
from uuid import UUID
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import ChatFolder, ChatFolderChat, Chat, ChatMember
from apps.payments.plan_limits import can_create_folders, RESTRICTION_CODE
from rest_framework.permissions import IsAuthenticated


class ChatFolderViewSet(viewsets.ModelViewSet):
    """CRUD for user chat folders."""
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        if not can_create_folders(self.request.user):
            return ChatFolder.objects.none()
        return ChatFolder.objects.filter(user=self.request.user).order_by("position", "created_at")

    def get_serializer_class(self):
        from .folder_serializers import ChatFolderSerializer
        return ChatFolderSerializer

    def create(self, request, *args, **kwargs):
        if not can_create_folders(request.user):
            return Response(
                {"detail": "Папки чатов доступны по подписке. Оформите подписку в настройках.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="chats")
    def add_chat(self, request, pk=None):
        folder = self.get_object()
        chat_id = request.data.get("chat_id")
        if not chat_id:
            return Response({"detail": "chat_id required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            chat_uuid = UUID(str(chat_id))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid chat_id."}, status=status.HTTP_400_BAD_REQUEST)

        # Verify user is member of chat
        if not ChatMember.objects.filter(
            chat_id=chat_uuid, user=request.user, status=ChatMember.Status.ACTIVE
        ).exists():
            return Response({"detail": "Chat not found or no access."}, status=status.HTTP_404_NOT_FOUND)

        ChatFolderChat.objects.get_or_create(folder=folder, chat_id=chat_uuid)
        return Response({"status": "ok"}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["delete"], url_path="chats/(?P<chat_id>[^/.]+)")
    def remove_chat(self, request, pk=None, chat_id=None):
        folder = self.get_object()
        try:
            chat_uuid = UUID(str(chat_id))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid chat_id."}, status=status.HTTP_400_BAD_REQUEST)

        deleted, _ = ChatFolderChat.objects.filter(
            folder=folder, chat_id=chat_uuid
        ).delete()
        return Response({"status": "ok", "deleted": deleted}, status=status.HTTP_200_OK)
