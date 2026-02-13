from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Chat, ChatMember, Message, MessageReaction, UserPinnedMessage, REACTION_EMOJIS, MAX_REACTIONS_PER_USER
from .serializers import MessageSerializer
from apps.users.serializers import UserSerializer


def _broadcast_message_updated(chat_id, message_data):
    """Уведомить участников чата об обновлении сообщения (редакт или реакция)."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"chat_{chat_id}",
                {"type": "chat.message.updated", "message": message_data},
            )
    except Exception:
        pass


def _check_chat_member(request, chat_id):
    chat = get_object_or_404(Chat, id=chat_id)
    if not chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).exists():
        return None, Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
    return chat, None


def _get_other_members_read(chat, request):
    """Список других участников чата с last_read_at для расчёта read_status и read_by."""
    other_members_read = []
    for m in (
        ChatMember.objects.filter(chat=chat, status=ChatMember.Status.ACTIVE)
        .exclude(user=request.user)
        .select_related("user")
    ):
        other_members_read.append({
            "user": UserSerializer(m.user, context={"request": request}).data,
            "last_read_at": m.last_read_at,
        })
    return other_members_read


class MessageListCreateView(APIView):
    def get(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        other_members_read = _get_other_members_read(chat, request)
        messages = (
            Message.objects.filter(chat=chat, is_deleted=False)
            .select_related("sender", "file")
            .prefetch_related("reactions", "files")
            .order_by("created_at")[:100]
        )
        context = {"request": request, "other_members_read": other_members_read}
        return Response(MessageSerializer(messages, many=True, context=context).data)

    def post(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        ser = MessageSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save(chat=chat, sender=request.user)
        return Response(ser.data, status=status.HTTP_201_CREATED)


class MessageDetailView(APIView):
    """GET одного сообщения, PATCH — редактирование (только текст, только своё)."""

    def get(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        ctx = {"request": request, "other_members_read": _get_other_members_read(chat, request)}
        return Response(MessageSerializer(msg, context=ctx).data)

    def patch(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        if msg.sender_id != request.user.id:
            return Response({"detail": "Можно редактировать только своё сообщение."}, status=status.HTTP_403_FORBIDDEN)
        if msg.msg_type != Message.MsgType.TEXT:
            return Response({"detail": "Редактировать можно только текстовые сообщения."}, status=status.HTTP_400_BAD_REQUEST)
        content = request.data.get("content")
        if content is None:
            return Response({"detail": "Укажите content."}, status=status.HTTP_400_BAD_REQUEST)
        msg.content = content
        msg.edited_at = timezone.now()
        msg.save(update_fields=["content", "edited_at"])
        ctx = {"request": request, "other_members_read": _get_other_members_read(chat, request)}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat.id), data)
        return Response(data)

    def delete(self, request, chat_id, message_id):
        """Мягкое удаление: только автор сообщения."""
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        if msg.sender_id != request.user.id:
            return Response(
                {"detail": "Можно удалить только своё сообщение."},
                status=status.HTTP_403_FORBIDDEN,
            )
        msg.is_deleted = True
        msg.save(update_fields=["is_deleted"])
        ctx = {"request": request, "other_members_read": _get_other_members_read(chat, request)}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat.id), data)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageReactionView(APIView):
    """POST: переключить реакцию (body: { "emoji": "👍" }). До 3 реакций на пользователя на сообщение. Пустой emoji — снять все свои реакции."""

    def post(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        emoji = (request.data.get("emoji") or "").strip()
        if emoji:
            if emoji not in REACTION_EMOJIS:
                return Response(
                    {"detail": f"Допустимые эмодзи: {', '.join(REACTION_EMOJIS)}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            existing = MessageReaction.objects.filter(
                message=msg, user=request.user, emoji=emoji
            ).first()
            if existing:
                existing.delete()
            else:
                count = MessageReaction.objects.filter(message=msg, user=request.user).count()
                if count >= MAX_REACTIONS_PER_USER:
                    return Response(
                        {"detail": f"Можно поставить не более {MAX_REACTIONS_PER_USER} реакций на сообщение."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                MessageReaction.objects.create(message=msg, user=request.user, emoji=emoji)
        else:
            MessageReaction.objects.filter(message=msg, user=request.user).delete()
        msg.refresh_from_db()
        ctx = {"request": request, "other_members_read": _get_other_members_read(chat, request)}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat.id), data)
        return Response(data)


class MessagePinView(APIView):
    """POST: закрепить сообщение для себя (scope=me) или для всех (scope=all). DELETE: открепить."""

    def post(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        scope = (request.data.get("scope") or request.query_params.get("scope") or "me").strip().lower()
        if scope == "all":
            membership = chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).first()
            if not membership or (membership.role != ChatMember.Role.ADMIN and chat.owner_id != request.user.id):
                return Response(
                    {"detail": "Закрепить для всех могут только владелец или администратор чата."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            chat.pinned_message = msg
            chat.save(update_fields=["pinned_message"])
        else:
            UserPinnedMessage.objects.get_or_create(user=request.user, chat=chat, message=msg)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        scope = (request.data.get("scope") or request.query_params.get("scope") or "me").strip().lower()
        if scope == "all":
            membership = chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).first()
            if not membership or (membership.role != ChatMember.Role.ADMIN and chat.owner_id != request.user.id):
                return Response(
                    {"detail": "Открепить для всех могут только владелец или администратор чата."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if chat.pinned_message_id == msg.id:
                chat.pinned_message = None
                chat.save(update_fields=["pinned_message"])
        else:
            UserPinnedMessage.objects.filter(user=request.user, chat=chat, message=msg).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
