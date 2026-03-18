"""
Tests for message edit and delete.
TOTEST §10.4, §10.5
"""
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, auth_client,
)


class MessageEditTest(TestCase):
    """PATCH own message — text updated, edited_at set."""

    def setUp(self):
        self.owner = create_user(phone="+79990000030", display_name="Owner")
        self.other = create_user(phone="+79990000031", display_name="Other")
        self.chat = create_chat(self.owner)
        add_member(self.chat, self.other)
        self.msg = create_message(self.chat, self.owner, "original text")

    def test_edit_own_message(self):
        client = auth_client(self.owner)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.patch(url, {"content": "edited text"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["content"], "edited text")
        self.assertIsNotNone(res.data["edited_at"])

    def test_edit_other_users_message_forbidden(self):
        client = auth_client(self.other)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.patch(url, {"content": "hack"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_edit_non_text_message_rejected(self):
        file_msg = create_message(self.chat, self.owner, "file", msg_type="file")
        client = auth_client(self.owner)
        url = f"/api/chats/{self.chat.id}/messages/{file_msg.id}/"
        res = client.patch(url, {"content": "edited"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_edit_without_content_rejected(self):
        client = auth_client(self.owner)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.patch(url, {}, format="json")
        self.assertEqual(res.status_code, 400)


class MessageDeleteTest(TestCase):
    """DELETE own message — soft delete, is_deleted=True, content hidden."""

    def setUp(self):
        self.owner = create_user(phone="+79990000040", display_name="Del")
        self.other = create_user(phone="+79990000041", display_name="Other")
        self.chat = create_chat(self.owner)
        add_member(self.chat, self.other)
        self.msg = create_message(self.chat, self.owner, "to delete")

    def test_delete_own_message(self):
        client = auth_client(self.owner)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.delete(url)
        self.assertEqual(res.status_code, 204)
        self.msg.refresh_from_db()
        self.assertTrue(self.msg.is_deleted)

    def test_delete_other_users_message_forbidden(self):
        client = auth_client(self.other)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.delete(url)
        self.assertEqual(res.status_code, 403)

    def test_deleted_message_hidden_from_list(self):
        self.msg.is_deleted = True
        self.msg.save(update_fields=["is_deleted"])
        client = auth_client(self.owner)
        res = client.get(f"/api/chats/{self.chat.id}/messages/")
        ids = [m["id"] for m in res.data]
        self.assertNotIn(str(self.msg.id), ids)

    def test_get_deleted_message_returns_404(self):
        self.msg.is_deleted = True
        self.msg.save(update_fields=["is_deleted"])
        client = auth_client(self.owner)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        res = client.get(url)
        self.assertEqual(res.status_code, 404)
