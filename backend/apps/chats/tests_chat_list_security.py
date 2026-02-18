from django.test import TestCase

from apps.chats.models import ChatMember
from apps.common.test_helpers import add_member, auth_client, create_chat, create_user
from apps.payments.models import UserSubscription


class ChatListSecurityTest(TestCase):
    def setUp(self):
        self.viewer = create_user(phone="+79990000020", display_name="Viewer")
        self.owner = create_user(phone="+79990000021", display_name="Owner")
        self.other_owner = create_user(phone="+79990000022", display_name="Other")
        UserSubscription.objects.create(user=self.viewer)

        self.allowed_chat = create_chat(self.owner, title="Allowed")
        add_member(self.allowed_chat, self.viewer)

        self.hidden_chat = create_chat(self.other_owner, title="Hidden")

        self.kicked_chat = create_chat(self.other_owner, title="Kicked")
        kicked_member = add_member(self.kicked_chat, self.viewer)
        kicked_member.status = ChatMember.Status.KICKED
        kicked_member.save(update_fields=["status"])

        self.pending_chat = create_chat(self.other_owner, title="Pending")
        pending_member = add_member(self.pending_chat, self.viewer)
        pending_member.status = ChatMember.Status.PENDING
        pending_member.save(update_fields=["status"])

    def test_chat_list_returns_only_active_memberships(self):
        client = auth_client(self.viewer)
        res = client.get("/api/chats/")
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        data = res.data if isinstance(res.data, list) else res.data.get("results", [])
        ids = {row["id"] for row in data}

        self.assertIn(str(self.allowed_chat.id), ids)
        self.assertNotIn(str(self.hidden_chat.id), ids)
        self.assertNotIn(str(self.kicked_chat.id), ids)
        self.assertNotIn(str(self.pending_chat.id), ids)

    def test_cannot_retrieve_chat_without_access(self):
        client = auth_client(self.viewer)
        res = client.get(f"/api/chats/{self.hidden_chat.id}/")
        self.assertEqual(res.status_code, 404, getattr(res, "data", None))
