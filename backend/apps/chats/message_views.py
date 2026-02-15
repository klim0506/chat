from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Chat, ChatMember, Message, MessageReaction, UserPinnedMessage, ChatPinnedMessage, REACTION_EMOJIS, MAX_REACTIONS_PER_USER
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


def _broadcast_new_message(chat_id, message_data):
    """Уведомить участников чата о новом сообщении (forward и др.)."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"chat_{chat_id}",
                {"type": "chat.message.broadcast", "message": message_data},
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
    """
    GET: список сообщений с курсорной пагинацией.
    Параметры:
      - limit (int, default=50, max=100): количество сообщений
      - before (ISO datetime): загрузить сообщения СТАРШЕ этой даты (скролл вверх)
      - since  (ISO datetime): загрузить сообщения НОВЕЕ этой даты (delta-sync)
    Ответ включает заголовок X-Has-More: true/false для индикации наличия более старых сообщений.
    """

    def get(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        other_members_read = _get_other_members_read(chat, request)

        # Parse limit
        try:
            limit = min(int(request.query_params.get("limit", 50)), 100)
        except (TypeError, ValueError):
            limit = 50

        qs = (
            Message.objects.filter(chat=chat, is_deleted=False)
            .select_related("sender", "file", "reply_to", "reply_to__sender", "reply_to__file", "forwarded_from", "forwarded_from_chat", "sender_device")
            .prefetch_related("reactions", "files")
        )

        from django.utils.dateparse import parse_datetime

        # Delta-sync: only return messages created after the given ISO timestamp
        since = request.query_params.get("since")
        before = request.query_params.get("before")

        if since:
            since_dt = parse_datetime(since)
            if since_dt:
                qs = qs.filter(created_at__gt=since_dt)
            # Delta-sync всегда отдаёт от старых к новым, без пагинации
            messages = list(qs.order_by("created_at")[:limit])
            has_more = False
        elif before:
            before_dt = parse_datetime(before)
            if before_dt:
                qs = qs.filter(created_at__lt=before_dt)
            # Курсорная пагинация: берём N+1 самых новых из тех, что СТАРШЕ before,
            # чтобы определить has_more, затем отдаём в хронологическом порядке
            messages_desc = list(qs.order_by("-created_at")[:limit + 1])
            has_more = len(messages_desc) > limit
            messages = list(reversed(messages_desc[:limit]))
        else:
            # Первая загрузка: самые свежие N сообщений
            messages_desc = list(qs.order_by("-created_at")[:limit + 1])
            has_more = len(messages_desc) > limit
            messages = list(reversed(messages_desc[:limit]))

        context = {"request": request, "other_members_read": other_members_read}
        response = Response(MessageSerializer(messages, many=True, context=context).data)
        response["X-Has-More"] = "true" if has_more else "false"
        return response

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
    """POST: закрепить сообщение для себя (scope=me) или для всех (scope=all). DELETE: открепить.
    Multi-pin для всех: ChatPinnedMessage, лимит зависит от expansion_tier."""

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
            # Check limit
            current_count = ChatPinnedMessage.objects.filter(chat=chat).count()
            if current_count >= chat.max_pins:
                return Response(
                    {"detail": f"Максимум {chat.max_pins} закреплённых сообщений для этого чата."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Determine next pin_order
            max_order = ChatPinnedMessage.objects.filter(chat=chat).order_by("-pin_order").values_list("pin_order", flat=True).first()
            next_order = (max_order or 0) + 1
            ChatPinnedMessage.objects.get_or_create(
                chat=chat, message=msg,
                defaults={"pinned_by": request.user, "pin_order": next_order},
            )
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
            ChatPinnedMessage.objects.filter(chat=chat, message=msg).delete()
        else:
            UserPinnedMessage.objects.filter(user=request.user, chat=chat, message=msg).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ForwardMessageView(APIView):
    """POST: переслать сообщение из одного чата в другой.
    Body: { "message_id": "<uuid>", "source_chat_id": "<uuid>" }
    """

    def post(self, request, chat_id):
        # Target chat
        target_chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        source_chat_id = request.data.get("source_chat_id")
        message_id = request.data.get("message_id")
        if not source_chat_id or not message_id:
            return Response(
                {"detail": "Укажите source_chat_id и message_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Check source chat access
        source_chat = get_object_or_404(Chat, id=source_chat_id)
        if not source_chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет доступа к исходному чату."}, status=status.HTTP_403_FORBIDDEN)
        # Get original message
        original = get_object_or_404(Message, id=message_id, chat=source_chat, is_deleted=False)
        # Create forwarded message in target chat
        forwarded = Message.objects.create(
            chat=target_chat,
            sender=request.user,
            msg_type=original.msg_type,
            content=original.content,
            file=original.file,
            waveform=original.waveform,
            forwarded_from=original.sender,
            forwarded_from_chat=source_chat,
        )
        # Copy M2M files
        all_files = list(original.files.all())
        if all_files:
            forwarded.files.set(all_files)
        elif original.file:
            forwarded.files.set([original.file])
        # Serialize and broadcast
        other_members_read = _get_other_members_read(target_chat, request)
        ctx = {"request": request, "other_members_read": other_members_read}
        data = MessageSerializer(forwarded, context=ctx).data
        _broadcast_new_message(str(target_chat.id), data)
        return Response(data, status=status.HTTP_201_CREATED)
