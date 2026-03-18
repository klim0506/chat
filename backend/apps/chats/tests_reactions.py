"""
Tests for message reactions: toggle, limits, counts, edge cases.
TOTEST §10.1
"""
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, auth_client,
)
from apps.chats.models import MessageReaction, REACTION_EMOJIS, MAX_REACTIONS_PER_USER
from apps.payments.services import create_subscription_for_user

# Use the first emojis from the allowed set to avoid hard-coding unicode
E1, E2, E3 = REACTION_EMOJIS[0], REACTION_EMOJIS[1], REACTION_EMOJIS[2]
E4 = REACTION_EMOJIS[3]


class ReactionToggleTest(TestCase):
    """POST same emoji twice → creates then removes reaction."""

    def setUp(self):
        self.user = create_user()
        create_subscription_for_user(self.user)
        self.chat = create_chat(self.user)
        self.msg = create_message(self.chat, self.user, "hi")
        self.client = auth_client(self.user)
        self.url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"

    def test_add_reaction(self):
        res = self.client.post(self.url, {"emoji": E1}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn(E1, res.data["reactions"])
        self.assertEqual(res.data["reactions"][E1], 1)

    def test_toggle_off(self):
        self.client.post(self.url, {"emoji": E1}, format="json")
        res = self.client.post(self.url, {"emoji": E1}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(E1, res.data.get("reactions", {}))

    def test_my_reactions_contains_added_emoji(self):
        self.client.post(self.url, {"emoji": E1}, format="json")
        res = self.client.post(self.url, {"emoji": E2}, format="json")
        self.assertIn(E1, res.data["my_reactions"])
        self.assertIn(E2, res.data["my_reactions"])


class ReactionLimitTest(TestCase):
    """Max 3 distinct emoji per user per message — 4th returns 400."""

    def setUp(self):
        self.user = create_user()
        create_subscription_for_user(self.user)
        self.chat = create_chat(self.user)
        self.msg = create_message(self.chat, self.user, "limits")
        self.client = auth_client(self.user)
        self.url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"

    def test_fourth_reaction_rejected(self):
        emojis = list(REACTION_EMOJIS)[:4]
        for emoji in emojis[:MAX_REACTIONS_PER_USER]:
            res = self.client.post(self.url, {"emoji": emoji}, format="json")
            self.assertEqual(res.status_code, 200, f"Failed on emoji {emoji}")
        res = self.client.post(self.url, {"emoji": emojis[3]}, format="json")
        self.assertEqual(res.status_code, 403, "4th reaction limited by plan returns 403")


class ReactionCountsTest(TestCase):
    """Reaction counts aggregate correctly across users."""

    def setUp(self):
        self.user1 = create_user(phone="+79990000001", display_name="U1")
        self.user2 = create_user(phone="+79990000002", display_name="U2")
        create_subscription_for_user(self.user1)
        create_subscription_for_user(self.user2)
        self.chat = create_chat(self.user1)
        add_member(self.chat, self.user2)
        self.msg = create_message(self.chat, self.user1, "counts")

    def test_counts_from_two_users(self):
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"
        auth_client(self.user1).post(url, {"emoji": E1}, format="json")
        auth_client(self.user2).post(url, {"emoji": E1}, format="json")
        auth_client(self.user2).post(url, {"emoji": E2}, format="json")

        res = auth_client(self.user1).get(
            f"/api/chats/{self.chat.id}/messages/{self.msg.id}/"
        )
        self.assertEqual(res.data["reactions"][E1], 2)
        self.assertEqual(res.data["reactions"][E2], 1)


class ReactionEdgeCaseTest(TestCase):
    """Reaction on deleted message → 404, from non-member → 403."""

    def setUp(self):
        self.owner = create_user(phone="+79990000010", display_name="Owner")
        self.outsider = create_user(phone="+79990000011", display_name="Out")
        create_subscription_for_user(self.owner)
        self.chat = create_chat(self.owner)
        self.msg = create_message(self.chat, self.owner, "edge")

    def test_reaction_on_deleted_message(self):
        self.msg.is_deleted = True
        self.msg.save(update_fields=["is_deleted"])
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"
        res = auth_client(self.owner).post(url, {"emoji": E1}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_reaction_from_non_member(self):
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"
        res = auth_client(self.outsider).post(url, {"emoji": E1}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_invalid_emoji_rejected(self):
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"
        res = auth_client(self.owner).post(url, {"emoji": "\U0001f984"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_empty_emoji_clears_all(self):
        url = f"/api/chats/{self.chat.id}/messages/{self.msg.id}/reactions/"
        client = auth_client(self.owner)
        client.post(url, {"emoji": E1}, format="json")
        client.post(url, {"emoji": E2}, format="json")
        self.assertEqual(MessageReaction.objects.filter(message=self.msg, user=self.owner).count(), 2)
        client.post(url, {"emoji": ""}, format="json")
        self.assertEqual(MessageReaction.objects.filter(message=self.msg, user=self.owner).count(), 0)
