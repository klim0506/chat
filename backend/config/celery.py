from celery import Celery
from celery.schedules import crontab
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

app = Celery("config")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "charge-recurring-subscriptions": {
        "task": "apps.payments.tasks.charge_recurring_subscriptions",
        "schedule": crontab(hour=0, minute=0),
    },
    "purge-old-idempotency-records": {
        "task": "apps.payments.tasks.purge_old_idempotency_records",
        "schedule": crontab(hour=3, minute=0),
    },
    "send-scheduled-messages": {
        "task": "apps.chats.tasks.send_scheduled_messages",
        "schedule": crontab(minute="*"),  # every minute
    },
}
