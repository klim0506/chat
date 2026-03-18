"""Celery tasks for E2EE app."""
from celery import shared_task

from .models import OneTimePreKey


@shared_task
def purge_used_prekeys():
    """
    Delete OneTimePreKey rows with is_used=True. They are never read again after use.
    Frees space; run daily.
    """
    deleted, _ = OneTimePreKey.objects.filter(is_used=True).delete()
    return {"deleted": deleted}
