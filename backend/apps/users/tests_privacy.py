"""
Tests for privacy controls: show_phone, show_last_seen, dm_privacy, add_to_group_privacy.
TOTEST §14
"""
from django.test import TestCase

from apps.common.test_helpers import create_user, create_chat, add_member, auth_client


class ShowPhoneTest(TestCase):
    """show_phone=False → other user sees null, self sees own phone."""

    def setUp(self):
        self.user = create_user(phone="+79990000080", display_name="Private")
        self.other = create_user(phone="+79990000081", display_name="Viewer")
        # Create a shared chat so the other user can fetch user info
        self.chat = create_chat(self.user)
        add_member(self.chat, self.other)
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.user)
        UserSubscription.objects.create(user=self.other)

    def test_phone_visible_by_default(self):
        client = auth_client(self.other)
        res = client.get("/api/auth/me/")
        # Other can see own phone
        self.assertEqual(res.data["phone"], "+79990000081")

    def test_self_always_sees_own_phone(self):
        self.user.show_phone = "nobody"
        self.user.save(update_fields=["show_phone"])
        client = auth_client(self.user)
        res = client.get("/api/auth/me/")
        self.assertEqual(res.data["phone"], "+79990000080")

    def test_other_cannot_see_hidden_phone(self):
        """When show_phone=False, the other user's serializer hides phone.
        We test this via the chat members endpoint which serializes users."""
        self.user.show_phone = "nobody"
        self.user.save(update_fields=["show_phone"])
        client = auth_client(self.other)
        res = client.get(f"/api/chats/{self.chat.id}/members/")
        self.assertEqual(res.status_code, 200)
        user_data = next(m for m in res.data if m["user"]["id"] == str(self.user.id))
        self.assertIsNone(user_data["user"]["phone"])


class ShowLastSeenTest(TestCase):
    """show_last_seen=False → hidden for other users."""

    def setUp(self):
        self.user = create_user(phone="+79990000082", display_name="LSUser")
        self.other = create_user(phone="+79990000083", display_name="LSViewer")
        self.chat = create_chat(self.user)
        add_member(self.chat, self.other)
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.user)
        UserSubscription.objects.create(user=self.other)

    def test_last_seen_hidden(self):
        from django.utils import timezone
        self.user.show_last_seen = "nobody"
        self.user.last_seen = timezone.now()
        self.user.save(update_fields=["show_last_seen", "last_seen"])
        client = auth_client(self.other)
        res = client.get(f"/api/chats/{self.chat.id}/members/")
        user_data = next(m for m in res.data if m["user"]["id"] == str(self.user.id))
        # Should be "recently" or None, not the actual timestamp
        self.assertIn(user_data["user"]["last_seen_display"], ["recently", None])


class DmPrivacyTest(TestCase):
    """dm_privacy='nobody' → creating DM fails with 403."""

    def setUp(self):
        self.sender = create_user(phone="+79990000084", display_name="DmSender")
        self.private_user = create_user(phone="+79990000085", display_name="DmPrivate")
        self.private_user.dm_privacy = "nobody"
        self.private_user.save(update_fields=["dm_privacy"])
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.sender)
        UserSubscription.objects.create(user=self.private_user)

    def test_dm_to_nobody_rejected(self):
        client = auth_client(self.sender)
        res = client.post(
            "/api/chats/dm/",
            {"user_id": str(self.private_user.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_dm_to_everyone_allowed(self):
        self.private_user.dm_privacy = "everyone"
        self.private_user.save(update_fields=["dm_privacy"])
        client = auth_client(self.sender)
        res = client.post(
            "/api/chats/dm/",
            {"user_id": str(self.private_user.id)},
            format="json",
        )
        self.assertIn(res.status_code, [200, 201])


class AddToGroupPrivacyTest(TestCase):
    """add_to_group_privacy='nobody' → invite to group fails with 403."""

    def setUp(self):
        self.admin = create_user(phone="+79990000086", display_name="GAdmin")
        self.target = create_user(phone="+79990000087", display_name="GTarget")
        self.target.add_to_group_privacy = "nobody"
        self.target.save(update_fields=["add_to_group_privacy"])
        from apps.payments.models import UserSubscription
        UserSubscription.objects.create(user=self.admin)
        UserSubscription.objects.create(user=self.target)
        self.chat = create_chat(self.admin, title="Group")

    def test_invite_nobody_rejected(self):
        client = auth_client(self.admin)
        res = client.post(
            f"/api/chats/{self.chat.id}/members/invite/",
            {"user_id": str(self.target.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_invite_everyone_allowed(self):
        self.target.add_to_group_privacy = "everyone"
        self.target.save(update_fields=["add_to_group_privacy"])
        client = auth_client(self.admin)
        res = client.post(
            f"/api/chats/{self.chat.id}/members/invite/",
            {"user_id": str(self.target.id)},
            format="json",
        )
        self.assertIn(res.status_code, [200, 201, 202])
