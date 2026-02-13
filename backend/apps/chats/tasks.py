from datetime import timedelta
from django.utils import timezone
from celery import shared_task
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import ChatMember, Message, ScheduledMessage


def _build_message_payload(msg):
    """Минимальный payload для broadcast (как в consumers._save_message)."""
    sender = getattr(msg, "sender", None)
    display_name = (sender.display_name or sender.phone) if sender else str(msg.sender_id)
    return {
        "id": str(msg.id),
        "chat_id": str(msg.chat_id),
        "sender_id": str(msg.sender_id),
        "sender_display_name": display_name,
        "msg_type": msg.msg_type,
        "content": msg.content,
        "file_id": str(msg.file_id) if msg.file_id else None,
        "created_at": msg.created_at.isoformat(),
    }


def _broadcast_new_message(chat_id, message_payload):
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"chat_{chat_id}",
                {"type": "chat.message.broadcast", "message": message_payload},
            )
    except Exception:
        pass


def _next_scheduled_at(sched):
    """Вычислить следующий scheduled_at для рекуррентного сообщения."""
    from datetime import datetime, time as dt_time
    now = timezone.now()
    t = sched.recurrence_time or dt_time(9, 0)
    if sched.recurrence == ScheduledMessage.Recurrence.DAILY:
        next_date = (sched.scheduled_at + timedelta(days=1)).date()
        return timezone.make_aware(datetime.combine(next_date, t))
    if sched.recurrence == ScheduledMessage.Recurrence.WEEKLY:
        # scheduled_at + 7 days, same weekday already
        next_dt = sched.scheduled_at + timedelta(days=7)
        next_date = next_dt.date()
        return timezone.make_aware(datetime.combine(next_date, t))
    return None


@shared_task
def send_scheduled_messages():
    """Отправить все отложенные сообщения, у которых scheduled_at <= now."""
    now = timezone.now()
    due = ScheduledMessage.objects.filter(scheduled_at__lte=now).select_related("chat", "user")
    for sched in due:
        try:
            if not ChatMember.objects.filter(
                chat=sched.chat, user=sched.user, status=ChatMember.Status.ACTIVE
            ).exists():
                sched.delete()
                continue
            msg = Message.objects.create(
                chat=sched.chat,
                sender=sched.user,
                msg_type=Message.MsgType.TEXT,
                content=sched.content,
            )
            payload = _build_message_payload(msg)
            _broadcast_new_message(str(sched.chat_id), payload)
            if sched.recurrence == ScheduledMessage.Recurrence.NONE:
                sched.delete()
            else:
                next_at = _next_scheduled_at(sched)
                if next_at:
                    sched.scheduled_at = next_at
                    sched.save(update_fields=["scheduled_at"])
                else:
                    sched.delete()
        except Exception:
            sched.delete()
