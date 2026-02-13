"""
Tests for message read status (delivered / read).
TOTEST §9.1
"""
from django.utils import timezone
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, auth_client,
)
from apps.chats.models import ChatMember


class ReadStatusTest(TestCase):
    """Message read_status delivered → read after mark-read."""

    def setUp(self):
        self.sender = create_user(phone="+79990000070", display_name="Sender")
        self.reader = create_user(phone="+79990000071", display_name="Reader")
        self.chat = create_chat(self.sender)
        add_member(self.chat, self.reader)
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.sender)
        UserSubscription.objects.create(user=self.reader)
        self.msg = create_message(self.chat, self.sender, "check status")

    def test_new_message_is_delivered(self):
        client = auth_client(self.sender)
        res = client.get(f"/api/chats/{self.chat.id}/messages/{self.msg.id}/")
        self.assertEqual(res.data["read_status"], "delivered")
        self.assertEqual(res.data["read_by"], [])

    def test_after_mark_read_status_becomes_read(self):
        # Reader marks chat as read
        reader_client = auth_client(self.reader)
        reader_client.post(f"/api/chats/{self.chat.id}/mark-read/")

        # Sender checks status
        sender_client = auth_client(self.sender)
        res = sender_client.get(f"/api/chats/{self.chat.id}/messages/{self.msg.id}/")
        self.assertEqual(res.data["read_status"], "read")
        read_by_ids = [u["id"] for u in res.data["read_by"]]
        self.assertIn(str(self.reader.id), read_by_ids)

    def test_read_status_none_for_others_message(self):
        """read_status is None when viewing someone else's message."""
        client = auth_client(self.reader)
        res = client.get(f"/api/chats/{self.chat.id}/messages/{self.msg.id}/")
        self.assertIsNone(res.data["read_status"])
