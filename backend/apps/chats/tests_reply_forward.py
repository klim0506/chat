"""
Tests for reply and forward features.
TOTEST §10.2, §10.3
"""
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, create_file, auth_client,
)


class ReplyTest(TestCase):
    """Create message with reply_to — response includes nested reply object."""

    def setUp(self):
        self.user = create_user()
        self.chat = create_chat(self.user)
        self.client = auth_client(self.user)
        self.original = create_message(self.chat, self.user, "original")

    def test_reply_includes_nested_object(self):
        res = self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "reply", "reply_to_id": str(self.original.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data["reply_to"])
        self.assertEqual(res.data["reply_to"]["id"], str(self.original.id))
        self.assertEqual(res.data["reply_to"]["content"], "original")

    def test_reply_to_message_with_file_shows_preview(self):
        f = create_file(self.user)
        original_with_file = create_message(
            self.chat, self.user, "with file", msg_type="file", file=f
        )
        res = self.client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {"msg_type": "text", "content": "reply to file", "reply_to_id": str(original_with_file.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data["reply_to"]["file"])


class ForwardTest(TestCase):
    """Forward message to another chat — fields set, files copied."""

    def setUp(self):
        self.sender = create_user(phone="+79990000020", display_name="Sender")
        self.receiver = create_user(phone="+79990000021", display_name="Receiver")
        self.source_chat = create_chat(self.sender, title="Source")
        add_member(self.source_chat, self.receiver)
        self.target_chat = create_chat(self.receiver, title="Target")
        add_member(self.target_chat, self.sender)
        self.original = create_message(self.source_chat, self.sender, "forwarded text")

    def test_forward_sets_fields(self):
        client = auth_client(self.sender)
        res = client.post(
            f"/api/chats/{self.target_chat.id}/messages/forward/",
            {"source_chat_id": str(self.source_chat.id), "message_id": str(self.original.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content"], "forwarded text")
        self.assertIsNotNone(res.data["forwarded_from"])
        self.assertEqual(res.data["forwarded_from"]["id"], str(self.sender.id))
        self.assertEqual(res.data["forwarded_from_chat_title"], "Source")

    def test_forward_copies_files(self):
        f1 = create_file(self.sender, "a.jpg")
        f2 = create_file(self.sender, "b.jpg")
        msg = create_message(self.source_chat, self.sender, "files", msg_type="file", file=f1)
        msg.files.set([f1, f2])

        client = auth_client(self.sender)
        res = client.post(
            f"/api/chats/{self.target_chat.id}/messages/forward/",
            {"source_chat_id": str(self.source_chat.id), "message_id": str(msg.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(len(res.data["files"]), 2)

    def test_forward_from_non_member_chat_forbidden(self):
        outsider = create_user(phone="+79990000022", display_name="Out")
        add_member(self.target_chat, outsider)
        private_chat = create_chat(self.sender, title="Private")
        private_msg = create_message(private_chat, self.sender, "secret")

        client = auth_client(outsider)
        res = client.post(
            f"/api/chats/{self.target_chat.id}/messages/forward/",
            {"source_chat_id": str(private_chat.id), "message_id": str(private_msg.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_forward_missing_fields_returns_400(self):
        client = auth_client(self.sender)
        res = client.post(
            f"/api/chats/{self.target_chat.id}/messages/forward/",
            {},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
