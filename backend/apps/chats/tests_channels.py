"""
Тесты системы каналов: открытый/закрытый канал, посты, комментарии, реакции.
"""
from django.test import TestCase

from apps.common.test_helpers import create_user, auth_client, create_file
from apps.chats.models import (
    Channel, ChannelMember, ChannelPost, ChannelPostComment, ChannelPostReaction,
)
from apps.chats.utils import generate_slug, make_verification_code, verify_invite_code
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
    """Создание, чтение, обновление канала."""

    def setUp(self):
        self.user = create_user()
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

    def test_create_channel_reserved_username_rejected(self):
        """Reserved usernames (e.g. support) cannot be used when creating a channel via API."""
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
    """Вступление в открытый и закрытый канал по ссылке."""

    def setUp(self):
        self.owner = create_user(phone="+79990001111")
        create_subscription_for_user(self.owner)
        self.user = create_user(phone="+79990002222")
        create_subscription_for_user(self.user)
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
    """Посты: создание, типы контента, редактирование, удаление."""

    def setUp(self):
        self.owner = create_user()
        create_subscription_for_user(self.owner)
        self.sub = create_user(phone="+79990003333")
        create_subscription_for_user(self.sub)
        self.channel = create_channel(self.owner, "Posts Channel")
        add_channel_subscriber(self.channel, self.sub)
        self.owner_client = auth_client(self.owner)
        self.sub_client = auth_client(self.sub)

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

    def test_subscriber_cannot_create_post(self):
        res = self.sub_client.post(
            f"/api/channels/{self.channel.id}/posts/",
            {"msg_type": "text", "content": "От подписчика"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_list_posts(self):
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

    def test_delete_post(self):
        post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="To delete",
        )
        res = self.owner_client.delete(f"/api/channels/{self.channel.id}/posts/{post.id}/")
        self.assertEqual(res.status_code, 204)
        post.refresh_from_db()
        self.assertTrue(post.is_deleted)


class ChannelCommentsTest(TestCase):
    """Комментарии к постам."""

    def setUp(self):
        self.owner = create_user()
        create_subscription_for_user(self.owner)
        self.sub = create_user(phone="+79990004444")
        create_subscription_for_user(self.sub)
        self.channel = create_channel(self.owner, "Comments Channel")
        add_channel_subscriber(self.channel, self.sub)
        self.post = ChannelPost.objects.create(
            channel=self.channel, author=self.owner, msg_type="text", content="Post",
        )
        self.owner_client = auth_client(self.owner)
        self.sub_client = auth_client(self.sub)

    def test_subscriber_can_comment(self):
        res = self.sub_client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
            {"msg_type": "text", "content": "Мой комментарий"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content"], "Мой комментарий")
        self.assertEqual(self.post.comments.filter(is_deleted=False).count(), 1)

    def test_comment_reply(self):
        c1 = ChannelPostComment.objects.create(
            post=self.post, author=self.sub, msg_type="text", content="First",
        )
        res = self.sub_client.post(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/",
            {"msg_type": "text", "content": "Reply", "reply_to_id": str(c1.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["reply_to"]["id"], str(c1.id))

    def test_edit_own_comment(self):
        comment = ChannelPostComment.objects.create(
            post=self.post, author=self.sub, msg_type="text", content="Original",
        )
        res = self.sub_client.patch(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/{comment.id}/",
            {"content": "Edited"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        comment.refresh_from_db()
        self.assertEqual(comment.content, "Edited")

    def test_delete_own_comment(self):
        comment = ChannelPostComment.objects.create(
            post=self.post, author=self.sub, msg_type="text", content="To delete",
        )
        res = self.sub_client.delete(
            f"/api/channels/{self.channel.id}/posts/{self.post.id}/comments/{comment.id}/",
        )
        self.assertEqual(res.status_code, 204)
        comment.refresh_from_db()
        self.assertTrue(comment.is_deleted)


class ChannelReactionsTest(TestCase):
    """Реакции на посты."""

    def setUp(self):
        self.user = create_user()
        create_subscription_for_user(self.user)
        self.channel = create_channel(self.user, "Reactions")
        self.post = ChannelPost.objects.create(
            channel=self.channel, author=self.user, msg_type="text", content="Post",
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
    """Участники: одобрение заявок, исключение."""

    def setUp(self):
        self.owner = create_user()
        create_subscription_for_user(self.owner)
        self.user = create_user(phone="+79990005555")
        create_subscription_for_user(self.user)
        self.channel = create_channel(self.owner, "Closed", is_public=False)
        self.pending = ChannelMember.objects.create(
            channel=self.channel, user=self.user,
            role=ChannelMember.Role.SUBSCRIBER, status=ChannelMember.Status.PENDING,
        )
        self.owner_client = auth_client(self.owner)

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
