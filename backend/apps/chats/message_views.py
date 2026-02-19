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
    """Notify chat members about a message update (edit or reaction)."""
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
    """Notify chat members about a new message (forward, etc.)."""
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
    """List of other chat members with last_read_at for computing read_status and read_by."""
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
    GET: message list with cursor-based pagination.
    Parameters:
      - limit (int, default=50, max=100): number of messages
      - before (ISO datetime): load messages OLDER than this date (scroll up)
      - since  (ISO datetime): load messages NEWER than this date (delta-sync)
    Response includes X-Has-More: true/false header indicating whether older messages exist.
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
            # Delta-sync always returns oldest to newest, no pagination
            messages = list(qs.order_by("created_at")[:limit])
            has_more = False
        elif before:
            before_dt = parse_datetime(before)
            if before_dt:
                qs = qs.filter(created_at__lt=before_dt)
            # Cursor pagination: take N+1 newest of those OLDER than before,
            # to determine has_more, then return in chronological order
            messages_desc = list(qs.order_by("-created_at")[:limit + 1])
            has_more = len(messages_desc) > limit
            messages = list(reversed(messages_desc[:limit]))
        else:
            # Initial load: most recent N messages
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
    """GET a single message, PATCH — edit (text only, own messages only)."""

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
        """Soft delete: message author only."""
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
    """POST: toggle a reaction (body: { "emoji": "👍" }). Up to 3 reactions per user per message. Empty emoji — remove all own reactions."""

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
    """POST: pin a message for self (scope=me) or for all (scope=all). DELETE: unpin.
    Multi-pin for all: ChatPinnedMessage, limit depends on expansion_tier."""

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


class MessageSearchView(APIView):
    """GET: search messages in a chat. ?q=text&limit=20&offset=0
    For secret (E2EE) chats, returns empty — search is client-side only."""

    def get(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        if chat.is_secret:
            return Response([])
        q = (request.query_params.get("q") or "").strip()
        if not q or len(q) < 2:
            return Response([])
        try:
            limit = min(int(request.query_params.get("limit", 20)), 50)
        except (TypeError, ValueError):
            limit = 20
        try:
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except (TypeError, ValueError):
            offset = 0
        qs = (
            Message.objects.filter(
                chat=chat, is_deleted=False, is_encrypted=False,
                content__icontains=q,
            )
            .select_related("sender", "file", "sender_device")
            .order_by("-created_at")
        )
        total = qs.count()
        messages = list(qs[offset:offset + limit])
        other_members_read = _get_other_members_read(chat, request)
        ctx = {"request": request, "other_members_read": other_members_read}
        data = MessageSerializer(messages, many=True, context=ctx).data
        return Response({"results": data, "total": total})


class GlobalMessageSearchView(APIView):
    """GET: search messages across all user's chats. ?q=text&limit=30
    Only searches non-encrypted messages in chats the user belongs to."""

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q or len(q) < 2:
            return Response({"results": []})
        try:
            limit = min(int(request.query_params.get("limit", 30)), 50)
        except (TypeError, ValueError):
            limit = 30
        my_chat_ids = ChatMember.objects.filter(
            user=request.user, status=ChatMember.Status.ACTIVE,
        ).values_list("chat_id", flat=True)
        qs = (
            Message.objects.filter(
                chat_id__in=my_chat_ids,
                is_deleted=False,
                is_encrypted=False,
                content__icontains=q,
            )
            .exclude(chat__is_secret=True)
            .select_related("sender", "chat", "file", "sender_device")
            .order_by("-created_at")[:limit]
        )
        results = []
        for msg in qs:
            results.append({
                "id": str(msg.id),
                "chat_id": str(msg.chat_id),
                "chat_title": msg.chat.title,
                "chat_is_personal": msg.chat.is_personal,
                "sender_id": str(msg.sender_id),
                "sender_name": msg.sender.display_name or msg.sender.phone,
                "content": msg.content[:200],
                "msg_type": msg.msg_type,
                "created_at": msg.created_at.isoformat(),
            })
        return Response({"results": results})


class ForwardMessageView(APIView):
    """POST: forward a message from one chat to another.
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
