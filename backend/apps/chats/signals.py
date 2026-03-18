"""Django signals for chats app."""
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Message


@receiver(post_save, sender=Message)
def on_message_created(sender, instance, created, **kwargs):
    """Record 'first_message' analytics event when user sends their first message."""
    if not created or instance.is_deleted:
        return
    try:
        from apps.users.models import record_analytics_event
        if Message.objects.filter(sender_id=instance.sender_id).count() == 1:
            record_analytics_event(
                instance.sender,
                "first_message",
                {"chat_id": str(instance.chat_id), "msg_type": instance.msg_type},
            )
    except Exception:
        pass
