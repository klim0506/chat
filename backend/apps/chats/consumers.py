import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Chat, ChatMember, Message


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.chat_id = self.scope["url_route"]["kwargs"]["chat_id"]
        self.room_group_name = f"chat_{self.chat_id}"
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return
        if not await self._user_can_join_chat(user.id):
            await self.close()
            return
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept(subprotocol="bearer")
        await self.channel_layer.group_send(self.room_group_name, {"type": "chat.join", "user_id": str(user.id), "display_name": user.display_name or user.phone})

    async def disconnect(self, close_code):
        user = self.scope.get("user")
        if user and user.is_authenticated:
            await self.channel_layer.group_send(self.room_group_name, {"type": "chat.leave", "user_id": str(user.id)})
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if data.get("type") == "chat.message":
            msg = await self._save_message(user.id, data)
            if msg:
                # Broadcast to chat room
                await self.channel_layer.group_send(self.room_group_name, {"type": "chat.message.broadcast", "message": msg})
                # Send notification to all other members via their personal groups
                await self._notify_members(user.id, msg)
        elif data.get("type") == "chat.typing":
            await self.channel_layer.group_send(self.room_group_name, {"type": "chat.typing.broadcast", "user_id": str(user.id), "display_name": user.display_name or user.phone})
        elif data.get("type") == "chat.read":
            await self.channel_layer.group_send(self.room_group_name, {"type": "chat.read.broadcast", "user_id": str(user.id), "message_id": data.get("message_id")})

    async def chat_message_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "chat.message", "message": event["message"]}))

    async def chat_message_updated(self, event):
        await self.send(text_data=json.dumps({"type": "chat.message.updated", "message": event["message"]}))

    async def chat_typing_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "chat.typing", "user_id": event["user_id"], "display_name": event["display_name"]}))

    async def chat_read_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "chat.read", "user_id": event["user_id"], "message_id": event.get("message_id")}))

    async def chat_mark_read_broadcast(self, event):
        await self.send(text_data=json.dumps({
            "type": "chat.mark_read",
            "user_id": event["user_id"],
            "last_read_at": event["last_read_at"],
        }))

    async def chat_join(self, event):
        await self.send(text_data=json.dumps({"type": "chat.join", "user_id": event["user_id"], "display_name": event["display_name"]}))

    async def chat_leave(self, event):
        await self.send(text_data=json.dumps({"type": "chat.leave", "user_id": event["user_id"]}))

    async def user_online_status(self, event):
        await self.send(text_data=json.dumps({
            "type": "user.online.status",
            "user_id": event["user_id"],
            "is_online": event["is_online"],
            "last_seen_display": event.get("last_seen_display"),
        }))

    @database_sync_to_async
    def _user_can_join_chat(self, user_id):
        return ChatMember.objects.filter(chat_id=self.chat_id, user_id=user_id, status=ChatMember.Status.ACTIVE).exists()

    @database_sync_to_async
    def _save_message(self, user_id, data):
        if not ChatMember.objects.filter(chat_id=self.chat_id, user_id=user_id, status=ChatMember.Status.ACTIVE).exists():
            return None
        is_encrypted = data.get("is_encrypted", False)
        encrypted_keys = data.get("encrypted_keys") or {}
        sender_device_id = data.get("sender_device_id")
        sender_device = None
        if sender_device_id:
            from apps.e2ee.models import Device
            try:
                sender_device = Device.objects.get(user_id=user_id, device_id=sender_device_id, is_active=True)
            except Device.DoesNotExist:
                pass
        msg = Message.objects.create(
            chat_id=self.chat_id,
            sender_id=user_id,
            msg_type=data.get("msg_type", "text"),
            content=data.get("content", ""),
            file_id=data.get("file_id") or None,
            reply_to_id=data.get("reply_to") or None,
            is_encrypted=is_encrypted,
            sender_device=sender_device,
            encrypted_keys=encrypted_keys,
        )
        # Attach multiple files (M2M) if provided
        file_ids = data.get("file_ids") or []
        if file_ids:
            from apps.files.models import FileAttachment
            attachments = FileAttachment.objects.filter(id__in=file_ids, uploader_id=user_id)
            msg.files.set(attachments)
            if not msg.file and attachments.exists():
                msg.file = attachments.first()
                msg.save(update_fields=["file"])
        sender = getattr(msg, "sender", None)
        display_name = (sender.display_name or sender.phone) if sender else str(user_id)
        # Build reply_to snapshot if replying
        reply_to_data = None
        if msg.reply_to_id:
            try:
                replied = Message.objects.select_related("sender").get(id=msg.reply_to_id)
                reply_sender = replied.sender
                sender_data = None
                if reply_sender:
                    sender_data = {
                        "id": str(reply_sender.id),
                        "display_name": reply_sender.display_name or reply_sender.phone,
                        "phone": reply_sender.phone if reply_sender.show_phone else None,
                    }
                reply_to_data = {
                    "id": str(replied.id),
                    "sender": sender_data,
                    "msg_type": replied.msg_type,
                    "content": "Зашифрованное сообщение" if getattr(replied, "is_encrypted", False) else replied.content,
                    "is_deleted": replied.is_deleted,
                    "created_at": replied.created_at.isoformat(),
                }
            except Message.DoesNotExist:
                pass
        result = {
            "id": str(msg.id),
            "chat_id": str(msg.chat_id),
            "sender_id": str(msg.sender_id),
            "sender_display_name": display_name,
            "msg_type": msg.msg_type,
            "content": msg.content,
            "file_id": str(msg.file_id) if msg.file_id else None,
            "created_at": msg.created_at.isoformat(),
            "reply_to": reply_to_data,
            "is_encrypted": msg.is_encrypted,
            "encrypted_keys": msg.encrypted_keys,
            "sender_device_id": msg.sender_device.device_id if msg.sender_device else None,
        }
        # Include file details for media messages
        from apps.files.views import make_file_token

        def _file_dict(att):
            token = make_file_token(str(att.id))
            return {
                "id": str(att.id),
                "original_name": att.original_name,
                "mime_type": att.mime_type,
                "size_bytes": att.size_bytes,
                "url": f"/api/files/{att.id}/?t={token}",
            }

        if msg.file_id:
            try:
                att = msg.file
                if att:
                    result["file"] = _file_dict(att)
            except Exception:
                pass
        # Include all files for multi-image messages
        all_files = list(msg.files.all())
        if all_files:
            result["files"] = [_file_dict(a) for a in all_files]
        elif msg.file_id and "file" in result:
            result["files"] = [result["file"]]
        else:
            result["files"] = []
        return result

    @database_sync_to_async
    def _get_members_to_notify(self, sender_id):
        """Get (user_id, is_muted, chat_title) for all active members except sender."""
        members = ChatMember.objects.filter(
            chat_id=self.chat_id,
            status=ChatMember.Status.ACTIVE,
        ).exclude(user_id=sender_id).select_related("chat").values_list(
            "user_id", "is_muted", "chat__title"
        )
        return list(members)

    async def _notify_members(self, sender_id, msg):
        """Send new-message notification to personal groups of chat members."""
        members = await self._get_members_to_notify(sender_id)
        for user_id, is_muted, chat_title in members:
            await self.channel_layer.group_send(
                f"user_{user_id}",
                {
                    "type": "notify.new_message",
                    "chat_id": str(self.chat_id),
                    "chat_title": chat_title,
                    "message": msg,
                    "is_muted": is_muted,
                },
            )


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    Global WebSocket per user: /ws/notifications/ (JWT in subprotocol).
    Receives notifications about new messages in ALL user's chats.
    Also tracks user online/offline status.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return
        self.user_id = str(user.id)
        self.group_name = f"user_{self.user_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept(subprotocol="bearer")
        # Mark user as online
        from apps.users.online import set_online
        set_online(self.user_id)
        # Broadcast online status to all user's chats
        await self._broadcast_online_status(True)

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if hasattr(self, "user_id"):
            # Mark user as offline and update last_seen
            from apps.users.online import set_offline
            set_offline(self.user_id)
            await self._update_last_seen()
            await self._broadcast_online_status(False)

    @database_sync_to_async
    def _update_last_seen(self):
        from django.utils import timezone
        from apps.users.models import User
        User.objects.filter(pk=self.user_id).update(last_seen=timezone.now())

    @database_sync_to_async
    def _get_user_chat_ids(self):
        return list(
            ChatMember.objects.filter(
                user_id=self.user_id,
                status=ChatMember.Status.ACTIVE,
            ).values_list("chat_id", flat=True)
        )

    @database_sync_to_async
    def _get_last_seen_display(self):
        from apps.users.models import User
        try:
            user = User.objects.get(pk=self.user_id)
            if not user.show_last_seen:
                return "recently"
            if user.last_seen:
                return user.last_seen.isoformat()
        except User.DoesNotExist:
            pass
        return None

    async def _broadcast_online_status(self, is_online: bool):
        """Broadcast user online/offline status to all chats the user is in."""
        chat_ids = await self._get_user_chat_ids()
        last_seen_display = None
        if not is_online:
            last_seen_display = await self._get_last_seen_display()
        for chat_id in chat_ids:
            await self.channel_layer.group_send(
                f"chat_{chat_id}",
                {
                    "type": "user.online.status",
                    "user_id": self.user_id,
                    "is_online": is_online,
                    "last_seen_display": last_seen_display,
                },
            )

    async def receive(self, text_data):
        # Client can send mark-read events
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if data.get("type") == "mark_read":
            chat_id = data.get("chat_id")
            if chat_id:
                last_read_at = await self._mark_read(chat_id)
                if last_read_at:
                    await self._broadcast_chat_mark_read(chat_id, last_read_at)

    async def notify_new_message(self, event):
        """Forward notification to the WebSocket client."""
        await self.send(text_data=json.dumps({
            "type": "new_message",
            "chat_id": event["chat_id"],
            "chat_title": event["chat_title"],
            "message": event["message"],
            "is_muted": event.get("is_muted", False),
        }))

    async def notify_new_login(self, event):
        """Forward new-login alert to the WebSocket client."""
        await self.send(text_data=json.dumps({
            "type": "new_login_alert",
            "session_id": event.get("session_id"),
            "device": event.get("device", ""),
            "ip": event.get("ip", ""),
            "time": event.get("time", ""),
        }))

    async def force_logout(self, event):
        """Tell specific sessions to log out."""
        await self.send(text_data=json.dumps({
            "type": "force_logout",
            "terminated_session_ids": event.get("terminated_session_ids", []),
        }))

    async def e2ee_prekeys_low(self, event):
        """Notify client to upload more one-time prekeys."""
        await self.send(text_data=json.dumps({
            "type": "e2ee.prekeys_low",
            "device_id": event.get("device_id"),
            "remaining": event.get("remaining"),
        }))

    @database_sync_to_async
    def _mark_read(self, chat_id):
        from django.utils import timezone
        now = timezone.now()
        ChatMember.objects.filter(
            chat_id=chat_id,
            user_id=self.user_id,
            status=ChatMember.Status.ACTIVE,
        ).update(last_read_at=now)
        return now

    async def _broadcast_chat_mark_read(self, chat_id, last_read_at):
        """Уведомить участников чата о прочтении (галочки)."""
        try:
            if self.channel_layer:
                await self.channel_layer.group_send(
                    f"chat_{chat_id}",
                    {
                        "type": "chat.mark_read.broadcast",
                        "user_id": self.user_id,
                        "last_read_at": last_read_at.isoformat() if hasattr(last_read_at, "isoformat") else str(last_read_at),
                    },
                )
        except Exception:
            pass
