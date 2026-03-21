"""
Tests for channels: join flow, posts, comments, reactions, and premium restrictions.
"""
from django.test import TestCase

from apps.common.test_helpers import auth_client, create_file, create_user
from apps.chats.models import (
    Channel,
    ChannelMember,
    ChannelPost,
    ChannelPostComment,
    ChannelPostReaction,
)
from apps.chats.utils import generate_slug, make_verification_code
from apps.payments.services import create_subscription_for_user


def create_channel(owner, title="Test Channel", is_public=True):
    slug = generate_slug()
    code = make_verification_code(slug)
    ch = Channel.objects.create(
        title=title,
        slug=slug,
        verification_code=code,
        is_public=is_public,
        owner=owner,
    )
    ChannelMember.objects.create(
        channel=ch,
        user=owner,
        role=ChannelMember.Role.OWNER,
        status=ChannelMember.Status.ACTIVE,
    )
    return ch


def add_channel_subscriber(channel, user, role=ChannelMember.Role.SUBSCRIBER):
    return ChannelMember.objects.create(
        channel=channel,
        user=user,
        role=role,
        status=ChannelMember.Status.ACTIVE,
    )


class ChannelCRUDTest(TestCase):
    def setUp(self):
        self.user = create_user(username="channel_owner")
        create_subscription_for_user(self.user)
        self.client = auth_client(self.user)

    def test_create_channel(self):
        res = self.client.post(
            "/api/channels/",
            {"title": "Мой канал", "description": "Описание", "is_public": True, "username": "moy_kanal"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["title"], "Мой канал")
        self.assertEqual(res.data["username"], "moy_kanal")
        self.assertTrue(res.data["is_public"])
        self.assertEqual(res.data["my_role"], "owner")
        self.assertIn("invite_link", res.data)

    def test_free_user_can_create_channel(self):
        free_user = create_user(phone="+79990009991", username="free_owner")
        free_client = auth_client(free_user)
        res = free_client.post(
            "/api/channels/",
            {"title": "Free channel", "is_public": True, "username": "free_channel"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["title"], "Free channel")
        self.assertEqual(res.data["my_role"], "owner")

    def test_create_channel_username_required(self):
        res = self.client.post(
            "/api/channels/",
            {"title": "Без username", "is_public": True},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("username", res.data)

    def test_create_closed_channel(self):
        res = self.client.post(
            "/api/channels/",
            {"title": "Закрытый канал", "is_public": False, "username": "closed_ch"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.data["is_public"])

    def test_list_my_channels(self):
        ch = create_channel(self.user, "First")
        res = self.client.get("/api/channels/")
        self.assertEqual(res.status_code, 200)
        data = res.data["results"] if isinstance(res.data, dict) and "results" in res.data else res.data
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["id"], str(ch.id))

    def test_update_channel(self):
        ch = create_channel(self.user, "Old title")
        res = self.client.patch(
            f"/api/channels/{ch.id}/",
            {"title": "New title", "comments_enabled": False},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.title, "New title")
        self.assertFalse(ch.comments_enabled)

    def test_free_owner_can_manage_channel(self):
        free_owner = create_user(phone="+79990009992", username="free_manage_owner")
        ch = create_channel(free_owner, "Managed")
        free_client = auth_client(free_owner)
        res = free_client.patch(
            f"/api/channels/{ch.id}/",
            {"title": "Updated"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["title"], "Updated")

    def test_create_channel_reserved_username_rejected(self):
        res = self.client.post(
            "/api/channels/",
            {"title": "Channel", "username": "support"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        err = res.data.get("username") or res.data.get("detail") or ""
        err_str = err[0] if isinstance(err, list) else str(err)
        self.assertIn("занят", err_str)


class ChannelJoinTest(TestCase):
    def setUp(self):
        self.owner = create_user(phone="+79990001111", username="join_owner")
        create_subscription_for_user(self.owner)
        self.user = create_user(phone="+79990002222", username="join_user")
        self.owner_client = auth_client(self.owner)
        self.user_client = auth_client(self.user)

    def test_join_public_channel(self):
        ch = create_channel(self.owner, "Public", is_public=True)
        res = self.user_client.post(
            "/api/channels/join/",
            {"slug": ch.slug, "code": ch.verification_code},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["title"], "Public")
        self.assertTrue(ChannelMember.objects.filter(channel=ch, user=self.user, status=ChannelMember.Status.ACTIVE).exists())

    def test_join_closed_channel_pending(self):
        ch = create_channel(self.owner, "Closed", is_public=False)
        res = self.user_client.post(
            "/api/channels/join/",
            {"slug": ch.slug, "code": ch.verification_code},
            format="json",
        )
        self.assertEqual(res.status_code, 202)
        self.assertIn("Ожидайте подтверждения", res.data["detail"])
        self.assertTrue(ChannelMember.objects.filter(channel=ch, user=self.user, status=ChannelMember.Status.PENDING).exists())

    def test_join_preview_public(self):
        ch = create_channel(self.owner, "Preview", is_public=True)
        res = self.user_client.post(
            "/api/channels/join/preview/",
            {"slug": ch.slug, "code": ch.verification_code},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_public"])
        self.assertEqual(res.data["title"], "Preview")

    def test_join_preview_already_member(self):
        ch = create_channel(self.owner, "Already")
        add_channel_subscriber(ch, self.user)
        res = self.user_client.post(
            "/api/channels/join/preview/",
            {"slug": ch.slug, "code": ch.verification_code},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.get("already_member"))


class ChannelPostsTest(TestCase):
    def setUp(self):
        self.owner = create_user(username="posts_owner")
        create_subscription_for_user(self.owner)
        self.sub = create_user(phone="+79990003333", username="posts_sub")
        self.admin = create_user(phone="+79990003334", username="posts_admin")
        self.channel = create_channel(self.owner, "Posts Channel")
        add_channel_subscriber(self.channel, self.sub)
        add_channel_subscriber(self.channel, self.admin, role=ChannelMember.Role.ADMIN)
        self.owner_client = auth_client(self.owner)
        self.sub_client = auth_client(self.sub)
        self.admin_client = auth_client(self.admin)

    def test_owner_can_create_post(self):
        res = self.owner_client.post(
            f"/api/channels/{self.channel.id}/posts/",
            {"msg_type": "text", "content": "Первый пост"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content"], "Первый пост")
        self.assertEqual(res.data["author"]["id"], str(self.owner.id))
        self.assertEqual(res.data["comments_count"], 0)

    def test_free_admin_cannot_create_post(self):
        res = self.admin_client.post(
            f"/api/channels/{self.channel.id}/posts/",
            {"msg_type": "text", "content": "Admin post"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "plan_restriction")

    def test_subscriber_cannot_create_post(self):
        res = self.sub_client.post(
            f"/api/channels/{self.channel.id}/posts/",
            {"msg_type": "text", "content": "От подписчика"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_list_posts_available_without_premium(self):
        ChannelPost.objects.create(channel=self.channel, author=self.owner, msg_type="text", content="A")
        ChannelPost.objects.create(channel=self.channel, author=self.owner, msg_type="text", content="B")
        res = self.sub_client.get(f"/api/channels/{self.channel.id}/posts/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)
        contents = [p["content"] for p in res.data]
        self.assertIn("A", contents)
        self.assertIn("B", contents)

    def test_post_with_file(self):
        f = create_file(self.owner, "pic.jpg")
        res = self.owner_client.post(
            f"/api/channels/{self.channel.id}/posts/",
            {"msg_type": "file", "content": "Фото", "file_id": str(f.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data.get("file"))

    def test_edit_post(self):
        post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="Old",
        )
        res = self.owner_client.patch(
            f"/api/channels/{self.channel.id}/posts/{post.id}/",
            {"content": "New"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        post.refresh_from_db()
        self.assertEqual(post.content, "New")
        self.assertIsNotNone(post.edited_at)

    def test_free_admin_cannot_edit_post(self):
        post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="Old",
        )
        res = self.admin_client.patch(
            f"/api/channels/{self.channel.id}/posts/{post.id}/",
            {"content": "Blocked"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "plan_restriction")

    def test_delete_post(self):
        post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="To delete",
        )
        res = self.owner_client.delete(f"/api/channels/{self.channel.id}/posts/{post.id}/")
        self.assertEqual(res.status_code, 204)
        post.refresh_from_db()
        self.assertTrue(post.is_deleted)

    def test_free_owner_cannot_import_telegram_history(self):
        free_owner = create_user(phone="+79990003335", username="free_import_owner")
        channel = create_channel(free_owner, "Importable")
        free_client = auth_client(free_owner)
        res = free_client.post(
            f"/api/channels/{channel.id}/import-telegram/",
            {},
            format="multipart",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "plan_restriction")


class ChannelCommentsTest(TestCase):
    def setUp(self):
        self.owner = create_user(username="comments_owner")
        create_subscription_for_user(self.owner)
        self.free_sub = create_user(phone="+79990004444", username="free_commenter")
        self.premium_sub = create_user(phone="+79990004445", username="premium_commenter")
        create_subscription_for_user(self.premium_sub)
        self.channel = create_channel(self.owner, "Comments Channel")
        add_channel_subscriber(self.channel, self.free_sub)
        add_channel_subscriber(self.channel, self.premium_sub)
        self.post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="Post",
        )
        self.owner_client = auth_client(self.owner)
        self.free_sub_client = auth_client(self.free_sub)
        self.premium_sub_client = auth_client(self.premium_sub)

    def test_free_subscriber_can_comment(self):
        res = self.free_sub_client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
            {"msg_type": "text", "content": "Мой комментарий"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content"], "Мой комментарий")
        self.assertEqual(self.post.comments.filter(is_deleted=False).count(), 1)

    def test_premium_subscriber_can_comment(self):
        res = self.premium_sub_client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
            {"msg_type": "text", "content": "Мой комментарий"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content"], "Мой комментарий")
        self.assertEqual(self.post.comments.filter(is_deleted=False).count(), 1)

    def test_comment_reply(self):
        c1 = ChannelPostComment.objects.create(
            post=self.post, author=self.premium_sub, msg_type="text", content="First",
        )
        res = self.premium_sub_client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
            {"msg_type": "text", "content": "Reply", "reply_to_id": str(c1.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["reply_to"]["id"], str(c1.id))

    def test_list_comments_available_without_premium(self):
        ChannelPostComment.objects.create(
            post=self.post, author=self.premium_sub, msg_type="text", content="Visible",
        )
        res = self.free_sub_client.get(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_edit_own_comment(self):
        comment = ChannelPostComment.objects.create(
            post=self.post, author=self.premium_sub, msg_type="text", content="Original",
        )
        res = self.premium_sub_client.patch(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/{comment.id}/",
            {"content": "Edited"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        comment.refresh_from_db()
        self.assertEqual(comment.content, "Edited")

    def test_delete_own_comment(self):
        comment = ChannelPostComment.objects.create(
            post=self.post, author=self.premium_sub, msg_type="text", content="To delete",
        )
        res = self.premium_sub_client.delete(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/{comment.id}/",
        )
        self.assertEqual(res.status_code, 204)
        comment.refresh_from_db()
        self.assertTrue(comment.is_deleted)


class ChannelReactionsTest(TestCase):
    def setUp(self):
        self.owner = create_user(username="reaction_owner")
        create_subscription_for_user(self.owner)
        self.user = create_user(phone="+79990005550", username="reaction_user")
        self.channel = create_channel(self.owner, "Reactions")
        add_channel_subscriber(self.channel, self.user)
        self.post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="Post",
        )
        self.client = auth_client(self.user)

    def test_add_reaction(self):
        res = self.client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/reactions/",
            {"emoji": "❤️"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["reactions"].get("❤️"), 1)
        self.assertIn("❤️", res.data["my_reactions"])

    def test_remove_reaction(self):
        ChannelPostReaction.objects.create(post=self.post, user=self.user, emoji="🔥")
        res = self.client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/reactions/",
            {"emoji": ""},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["my_reactions"]), 0)


class ChannelMembersTest(TestCase):
    def setUp(self):
        self.owner = create_user(username="members_owner")
        create_subscription_for_user(self.owner)
        self.free_owner = create_user(phone="+79990005556", username="members_free_owner")
        self.user = create_user(phone="+79990005555", username="members_user")
        self.channel = create_channel(self.owner, "Closed", is_public=False)
        self.free_channel = create_channel(self.free_owner, "Free Closed", is_public=False)
        self.pending = ChannelMember.objects.create(
            channel=self.channel,
            user=self.user,
            role=ChannelMember.Role.SUBSCRIBER,
            status=ChannelMember.Status.PENDING,
        )
        self.free_pending = ChannelMember.objects.create(
            channel=self.free_channel,
            user=self.user,
            role=ChannelMember.Role.SUBSCRIBER,
            status=ChannelMember.Status.PENDING,
        )
        self.owner_client = auth_client(self.owner)
        self.free_owner_client = auth_client(self.free_owner)

    def test_approve_pending(self):
        res = self.owner_client.post(
            f"/api/channels/{self.channel.id}/members/approve-reject/",
            {"member_id": str(self.pending.id), "action": "approve"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, ChannelMember.Status.ACTIVE)

    def test_reject_pending(self):
        res = self.owner_client.post(
            f"/api/channels/{self.channel.id}/members/approve-reject/",
            {"member_id": str(self.pending.id), "action": "reject"},
            format="json",
        )
        self.assertEqual(res.status_code, 204)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, ChannelMember.Status.KICKED)

    def test_free_owner_cannot_approve_pending(self):
        res = self.free_owner_client.post(
            f"/api/channels/{self.free_channel.id}/members/approve-reject/",
            {"member_id": str(self.free_pending.id), "action": "approve"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "plan_restriction")
