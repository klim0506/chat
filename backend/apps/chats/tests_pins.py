"""
Tests for pinned messages (scope=all, scope=me, limits, pin_order).
TOTEST §4, §12
"""
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, auth_client,
)
from apps.chats.models import ChatPinnedMessage, UserPinnedMessage, ChatMember


class PinForAllTest(TestCase):
    """scope=all → ChatPinnedMessage created with pin_order."""

    def setUp(self):
        self.admin = create_user(phone="+79990000050", display_name="Admin")
        self.member = create_user(phone="+79990000051", display_name="Member")
        self.chat = create_chat(self.admin)
        add_member(self.chat, self.member)
        self.msg1 = create_message(self.chat, self.admin, "pin me 1")
        self.msg2 = create_message(self.chat, self.admin, "pin me 2")

    def test_pin_creates_record(self):
        client = auth_client(self.admin)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg1.id}/pin/"
        res = client.post(url, {"scope": "all"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertTrue(ChatPinnedMessage.objects.filter(chat=self.chat, message=self.msg1).exists())

    def test_pin_order_increments(self):
        # Expand chat to allow multiple pins (tier 100 → max_pins=5)
        from django.utils import timezone
        import datetime
        self.chat.expanded_until = timezone.now() + datetime.timedelta(days=30)
        self.chat.expansion_tier = 100
        self.chat.save(update_fields=["expanded_until", "expansion_tier"])
        self.assertGreaterEqual(self.chat.max_pins, 2)

        client = auth_client(self.admin)
        res1 = client.post(
            f"/api/chats/{self.chat.id}/messages/{self.msg1.id}/pin/",
            {"scope": "all"}, format="json",
        )
        self.assertEqual(res1.status_code, 204)
        res2 = client.post(
            f"/api/chats/{self.chat.id}/messages/{self.msg2.id}/pin/",
            {"scope": "all"}, format="json",
        )
        self.assertEqual(res2.status_code, 204)
        p1 = ChatPinnedMessage.objects.get(chat=self.chat, message=self.msg1)
        p2 = ChatPinnedMessage.objects.get(chat=self.chat, message=self.msg2)
        self.assertLess(p1.pin_order, p2.pin_order)

    def test_non_admin_cannot_pin_for_all(self):
        client = auth_client(self.member)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg1.id}/pin/"
        res = client.post(url, {"scope": "all"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_unpin_removes_record(self):
        client = auth_client(self.admin)
        pin_url = f"/api/chats/{self.chat.id}/messages/{self.msg1.id}/pin/"
        client.post(pin_url, {"scope": "all"}, format="json")
        self.assertTrue(ChatPinnedMessage.objects.filter(chat=self.chat, message=self.msg1).exists())
        res = client.delete(pin_url, {"scope": "all"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(ChatPinnedMessage.objects.filter(chat=self.chat, message=self.msg1).exists())


class PinLimitTest(TestCase):
    """Pin over Chat.max_pins → 400."""

    def setUp(self):
        self.admin = create_user(phone="+79990000055", display_name="LimAdmin")
        self.chat = create_chat(self.admin)
        # Default max_pins for non-expanded chat is 1
        self.assertEqual(self.chat.max_pins, 1)

    def test_pin_over_limit_returns_400(self):
        client = auth_client(self.admin)
        msg1 = create_message(self.chat, self.admin, "p1")
        msg2 = create_message(self.chat, self.admin, "p2")
        client.post(
            f"/api/chats/{self.chat.id}/messages/{msg1.id}/pin/",
            {"scope": "all"}, format="json",
        )
        res = client.post(
            f"/api/chats/{self.chat.id}/messages/{msg2.id}/pin/",
            {"scope": "all"}, format="json",
        )
        self.assertEqual(res.status_code, 400)


class PinForMeTest(TestCase):
    """scope=me → UserPinnedMessage created (personal pin)."""

    def setUp(self):
        self.user = create_user(phone="+79990000060", display_name="Me")
        self.chat = create_chat(self.user)
        self.msg = create_message(self.chat, self.user, "personal pin")

    def test_pin_for_me_creates_user_pin(self):
        client = auth_client(self.user)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/pin/"
        res = client.post(url, {"scope": "me"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertTrue(UserPinnedMessage.objects.filter(user=self.user, chat=self.chat, message=self.msg).exists())

    def test_unpin_for_me(self):
        client = auth_client(self.user)
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/pin/"
        client.post(url, {"scope": "me"}, format="json")
        res = client.delete(url, {"scope": "me"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(UserPinnedMessage.objects.filter(user=self.user, chat=self.chat, message=self.msg).exists())


class ChatPinOrderApiTest(TestCase):
    """ChatMember.pin_order for chat list pinning (TOTEST §4)."""

    def setUp(self):
        self.user = create_user(phone="+79990000065", display_name="Pins")
        self.chat1 = create_chat(self.user, title="Pin A")
        self.chat2 = create_chat(self.user, title="Pin B")
        self.chat3 = create_chat(self.user, title="Pin C")
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.user)
        self.client = auth_client(self.user)

    def test_set_pins_persists_order(self):
        res = self.client.post(
            "/api/chats/pins/",
            {"chat_ids": [str(self.chat2.id), str(self.chat1.id)]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        m1 = ChatMember.objects.get(chat=self.chat1, user=self.user)
        m2 = ChatMember.objects.get(chat=self.chat2, user=self.user)
        m3 = ChatMember.objects.get(chat=self.chat3, user=self.user)
        self.assertEqual(m2.pin_order, 1)
        self.assertEqual(m1.pin_order, 2)
        self.assertIsNone(m3.pin_order)

    def test_unpin_clears_order(self):
        self.client.post(
            "/api/chats/pins/",
            {"chat_ids": [str(self.chat1.id)]},
            format="json",
        )
        # Unpin all
        self.client.post("/api/chats/pins/", {"chat_ids": []}, format="json")
        m = ChatMember.objects.get(chat=self.chat1, user=self.user)
        self.assertIsNone(m.pin_order)
