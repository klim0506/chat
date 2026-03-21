import json
import re
from django.db import connection
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Chat, ChatMember, Message, MessageReaction, UserPinnedMessage, ChatPinnedMessage, PollVote, REACTION_EMOJIS, MAX_REACTIONS_PER_USER
from apps.payments.plan_limits import get_max_reactions_per_message, RESTRICTION_CODE
from .serializers import MessageSerializer, MESSAGE_CONTENT_MAX_LENGTH
from apps.users.serializers import UserSerializer


def _message_preview_for_notification(msg):
    """Short preview of a message for reaction notification (single message, not i18n)."""
    if getattr(msg, "is_encrypted", False):
        return "зашифрованное сообщение"
    mime = (getattr(msg, "file", None) and getattr(msg.file, "mime_type", None)) or ""
    if msg.msg_type == "audio":
        return "голосовое сообщение"
    if msg.msg_type == "gif":
        return "GIF"
    if msg.msg_type == "sticker":
        return "стикер"
    if msg.msg_type in ("video", "video_circle") or str(mime).startswith("video/"):
        return "видео"
    if str(mime).startswith("image/"):
        return "фото"
    if msg.msg_type == "file":
        return "файл"
    text = (msg.content or "").strip()
    if not text:
        return "сообщение"
    return (text[:50] + "…") if len(text) > 50 else text


def _notify_reaction_to_author(chat, msg, reactor, emoji):
    """Send push to message author: '{{name}} отреагировал \"{{emoji}}\" на {{message}}'."""
    if not msg.sender_id or str(msg.sender_id) == str(reactor.id):
        return
    reactor_name = reactor.display_name or getattr(reactor, "username", None) or "Пользователь"
    preview = _message_preview_for_notification(msg)
    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            f"user_{msg.sender_id}",
            {
                "type": "notify.reaction_on_message",
                "chat_id": str(chat.id),
                "chat_title": chat.title or "",
                "reactor_name": reactor_name,
                "emoji": emoji,
                "message_preview": preview,
            },
        )
    except Exception:
        pass


def _notify_members_message_deleted(chat_id, message_payload):
    """Push delete to each member's /ws/notifications/ (all tabs/devices), not only chat room WS."""
    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        member_ids = ChatMember.objects.filter(
            chat_id=chat_id, status=ChatMember.Status.ACTIVE
        ).values_list("user_id", flat=True)
        for uid in member_ids:
            async_to_sync(channel_layer.group_send)(
                f"user_{uid}",
                {
                    "type": "notify.message_updated",
                    "chat_id": str(chat_id),
                    "message": message_payload,
                },
            )
    except Exception:
        pass


def _broadcast_message_updated(chat_id, message_data):
    """Notify chat members about a message update (edit, reaction, or soft-delete)."""
    try:
        payload = _message_data_serializable(message_data)
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"chat_{chat_id}",
                {"type": "chat.message.updated", "message": payload},
            )
        if payload.get("is_deleted"):
            _notify_members_message_deleted(str(chat_id), payload)
    except Exception:
        pass


def _message_data_serializable(message_data):
    """Convert serializer output to a plain JSON-serializable dict for channel layer (Redis)."""
    try:
        return json.loads(json.dumps(message_data, default=str))
    except (TypeError, ValueError):
        return dict(message_data)


def _broadcast_new_message(chat_id, message_data):
    """Notify chat members about a new message (forward, etc.). Reaches all devices/tabs with chat open."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            payload = _message_data_serializable(message_data)
            async_to_sync(channel_layer.group_send)(
                f"chat_{chat_id}",
                {"type": "chat.message.broadcast", "message": payload},
            )
    except Exception:
        pass


def _notify_members_new_message(chat_id, sender_id, message_data):
    """Send new_message to each member's notification group (including sender's other devices)."""
    content = (message_data.get("content") or "").strip()
    payload = _message_data_serializable(message_data)
    members = (
        ChatMember.objects.filter(chat_id=chat_id, status=ChatMember.Status.ACTIVE)
        .select_related("chat", "user")
    )
    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        for m in members:
            is_mention = False
            if content:
                identifiers = []
                u = m.user
                if getattr(u, "username", None):
                    identifiers.append(re.escape(u.username))
                if getattr(u, "display_name", None):
                    for part in (u.display_name or "").split():
                        if part and len(part) > 1:
                            identifiers.append(re.escape(part))
                if getattr(u, "telegram_username", None):
                    identifiers.append(re.escape(u.telegram_username))
                if identifiers:
                    pattern = r"@(" + "|".join(identifiers) + r")\b"
                    if re.search(pattern, content, re.IGNORECASE):
                        is_mention = True
            notify_effectively_muted = m.is_muted and not is_mention
            is_sender = str(m.user_id) == str(sender_id)
            async_to_sync(channel_layer.group_send)(
                f"user_{m.user_id}",
                {
                    "type": "notify.new_message",
                    "chat_id": str(chat_id),
                    "chat_title": m.chat.title,
                    "message": payload,
                    "is_muted": notify_effectively_muted if not is_sender else True,
                    "is_mention": is_mention and not is_sender,
                },
            )
    except Exception:
        pass


def _process_delete_after_read(chat_id, user_id, last_read_at):
    """Soft-delete messages with delete_after_read=True that the user has now read. Broadcast updates."""
    messages = Message.objects.filter(
        chat_id=chat_id,
        delete_after_read=True,
        is_deleted=False,
    ).exclude(sender_id=user_id).filter(created_at__lte=last_read_at)
    for msg in messages:
        msg.is_deleted = True
        msg.save(update_fields=["is_deleted"])
        ctx = {"request": None, "other_members_read": []}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat_id), data)


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
        # #region agent log
        try:
            _content_in = request.data.get("content")
            _msg_type = request.data.get("msg_type")
            _has_file = bool(request.data.get("file_id") or request.data.get("file_ids"))
        except Exception:
            _content_in = _msg_type = _has_file = None
        # #endregion
        ser = MessageSerializer(data=request.data, context={"request": request, "chat": chat})
        ser.is_valid(raise_exception=True)
        ser.save(chat=chat, sender=request.user)
        # Broadcast new message to all devices/tabs (chat WebSocket room) so files, voice, images, etc. sync in real time
        other_members_read = _get_other_members_read(chat, request)
        ctx = {"request": request, "other_members_read": other_members_read}
        data = MessageSerializer(ser.instance, context=ctx).data
        _broadcast_new_message(str(chat.id), data)
        _notify_members_new_message(chat.id, request.user.id, data)
        # #region agent log
        try:
            import json
            _saved = getattr(ser.instance, "content", None) or ""
            _log = {"content_in_len": len(_content_in) if _content_in else 0, "content_in_preview": (_content_in or "")[:60], "msg_type": _msg_type, "has_file": _has_file, "content_saved_len": len(_saved), "content_saved_preview": _saved[:60]}
            for _path in ["/root/.cursor/debug-025e9f.log", "/root/chat/backend/debug_caption.log"]:
                try:
                    with open(_path, "a") as _f:
                        _f.write(json.dumps(_log, ensure_ascii=False) + "\n")
                    break
                except Exception:
                    continue
        except Exception:
            pass
        # #endregion
        return Response(data, status=status.HTTP_201_CREATED)


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
        if len(content) > MESSAGE_CONTENT_MAX_LENGTH:
            return Response(
                {"content": f"Максимум {MESSAGE_CONTENT_MAX_LENGTH} символов."},
                status=status.HTTP_400_BAD_REQUEST,
            )
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


class BulkDeleteMessagesView(APIView):
    """POST: bulk soft-delete messages. Body: { "message_ids": ["uuid", ...] }.
    User can delete own messages; admin/owner can delete any message in the chat."""

    def post(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        membership = chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        is_admin = membership.role == ChatMember.Role.ADMIN or chat.owner_id == request.user.id

        message_ids = request.data.get("message_ids") or []
        if not isinstance(message_ids, list):
            return Response(
                {"detail": "Укажите message_ids — массив UUID."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(message_ids) > 100:
            return Response(
                {"detail": "Максимум 100 сообщений за раз."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        messages = Message.objects.filter(
            id__in=message_ids,
            chat=chat,
            is_deleted=False,
        ).select_related("sender")

        deleted = 0
        ctx = {"request": request, "other_members_read": _get_other_members_read(chat, request)}
        for msg in messages:
            if msg.sender_id == request.user.id or is_admin:
                msg.is_deleted = True
                msg.save(update_fields=["is_deleted"])
                data = MessageSerializer(msg, context=ctx).data
                _broadcast_message_updated(str(chat.id), data)
                deleted += 1

        return Response({"deleted": deleted}, status=status.HTTP_200_OK)


class MessageReactionView(APIView):
    """POST: toggle a reaction (body: { "emoji": "👍" }). Up to 3 reactions per user per message. Empty emoji — remove all own reactions."""

    def post(self, request, chat_id, message_id):
        # #region agent log
        try:
            import json, time
            _log = {"sessionId": "5254ee", "hypothesisId": "H3", "location": "chats/message_views.py:MessageReactionView.post", "message": "reactions_view_entered", "data": {"chat_id": str(chat_id), "message_id": str(message_id)}, "timestamp": time.time() * 1000}
            open("/tmp/debug-5254ee.log", "a").write(json.dumps(_log) + "\n")
        except Exception:
            pass
        # #endregion
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
                max_reactions = get_max_reactions_per_message(request.user)
                if count >= max_reactions:
                    return Response(
                        {"detail": f"На вашем тарифе можно поставить не более {max_reactions} реакции на сообщение. Оформите подписку для до 3.", "code": RESTRICTION_CODE},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                MessageReaction.objects.create(message=msg, user=request.user, emoji=emoji)
                _notify_reaction_to_author(chat, msg, request.user, emoji)
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
        # Use PostgreSQL full-text search when available; fallback to icontains for SQLite
        if connection.vendor == "postgresql":
            from django.contrib.postgres.search import SearchQuery, SearchVector
            search_query = SearchQuery(q, config="simple", search_type="plain")
            qs = (
                Message.objects.filter(
                    chat=chat, is_deleted=False, is_encrypted=False,
                )
                .annotate(search=SearchVector("content", config="simple"))
                .filter(search=search_query)
                .select_related("sender", "file", "sender_device")
                .order_by("-created_at")
            )
        else:
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
        my_chat_ids = list(
            ChatMember.objects.filter(
                user=request.user, status=ChatMember.Status.ACTIVE,
            ).values_list("chat_id", flat=True)
        )
        if not my_chat_ids:
            return Response({"results": []})
        # Use PostgreSQL full-text search when available; fallback to icontains for SQLite
        if connection.vendor == "postgresql":
            from django.contrib.postgres.search import SearchQuery, SearchVector
            search_query = SearchQuery(q, config="simple", search_type="plain")
            qs = (
                Message.objects.filter(
                    chat_id__in=my_chat_ids,
                    is_deleted=False,
                    is_encrypted=False,
                )
                .annotate(search=SearchVector("content", config="simple"))
                .filter(search=search_query)
                .exclude(chat__is_secret=True)
                .select_related("sender", "chat", "file", "sender_device")
                .order_by("-created_at")[:limit]
            )
        else:
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
        create_kw = dict(
            chat=target_chat,
            sender=request.user,
            msg_type=original.msg_type,
            content=original.content,
            file=original.file,
            waveform=original.waveform,
            duration_seconds=original.duration_seconds,
            forwarded_from=original.sender,
            forwarded_from_chat=source_chat,
        )
        if original.msg_type == "poll" and original.poll_data:
            create_kw["poll_data"] = original.poll_data
        forwarded = Message.objects.create(**create_kw)
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


class PollVoteView(APIView):
    """POST: vote on a poll. Body: { "option_indices": [0] } or [0, 2] for multiple. Empty array = unvote.
    DELETE: unvote."""

    def post(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        if msg.msg_type != "poll" or not msg.poll_data:
            return Response({"detail": "Это не опрос."}, status=status.HTTP_400_BAD_REQUEST)
        options = msg.poll_data.get("options") or []
        multiple = msg.poll_data.get("multiple", False)
        raw = request.data.get("option_indices")
        if raw is None:
            return Response({"detail": "Укажите option_indices."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(raw, list):
            return Response({"detail": "option_indices должен быть массивом."}, status=status.HTTP_400_BAD_REQUEST)
        option_indices = [int(x) for x in raw if isinstance(x, (int, float)) and 0 <= int(x) < len(options)]
        if not multiple and len(option_indices) > 1:
            option_indices = option_indices[:1]
        PollVote.objects.update_or_create(
            message=msg, user=request.user,
            defaults={"option_indices": option_indices},
        )
        msg.refresh_from_db()
        other_members_read = _get_other_members_read(chat, request)
        ctx = {"request": request, "other_members_read": other_members_read}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat.id), data)
        return Response(data)

    def delete(self, request, chat_id, message_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        msg = get_object_or_404(Message, id=message_id, chat=chat, is_deleted=False)
        PollVote.objects.filter(message=msg, user=request.user).delete()
        msg.refresh_from_db()
        other_members_read = _get_other_members_read(chat, request)
        ctx = {"request": request, "other_members_read": other_members_read}
        data = MessageSerializer(msg, context=ctx).data
        _broadcast_message_updated(str(chat.id), data)
        return Response(data)
