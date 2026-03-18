"""Tests for sticker packs API."""
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.chats.tests import _make_token, _create_user, _create_file
from apps.chats.models import StickerSet, Sticker, UserStickerSet, RecentSticker


class StickerPackAPITest(TestCase):
    """API tests for sticker packs."""

    def setUp(self):
        self.user = _create_user()
        self.other_user = _create_user(phone="79990001133", display_name="Other")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {_make_token(self.user)}")

    @patch("apps.chats.sticker_views.can_create_custom_stickers", return_value=True)
    def test_create_pack(self, mock_can_create):
        """POST /api/stickers/packs/ creates a pack."""
        res = self.client.post(
            "/api/stickers/packs/",
            {"title": "My Stickers", "short_name": "my_stickers"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["title"], "My Stickers")
        self.assertEqual(res.data["short_name"], "my_stickers")
        self.assertEqual(res.data["owner_id"], str(self.user.id))
        pack = StickerSet.objects.get(owner=self.user, short_name="my_stickers")
        self.assertEqual(pack.title, "My Stickers")

    def test_create_pack_requires_auth(self):
        """Create pack requires authentication."""
        client = APIClient()
        res = client.post(
            "/api/stickers/packs/",
            {"title": "X", "short_name": "x"},
            format="json",
        )
        self.assertEqual(res.status_code, 401)

    @patch("apps.chats.sticker_views.can_create_custom_stickers", return_value=True)
    def test_create_pack_validation(self, mock_can_create):
        """Create pack validates title and short_name."""
        res = self.client.post(
            "/api/stickers/packs/",
            {"title": "", "short_name": "x"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

        res = self.client.post(
            "/api/stickers/packs/",
            {"title": "X", "short_name": "ab"},  # too short
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_list_packs(self):
        """GET /api/stickers/packs/ returns own packs."""
        StickerSet.objects.create(owner=self.user, title="P1", short_name="p1")
        StickerSet.objects.create(owner=self.user, title="P2", short_name="p2")
        StickerSet.objects.create(owner=self.other_user, title="Other", short_name="other")

        res = self.client.get("/api/stickers/packs/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)
        titles = {p["title"] for p in res.data}
        self.assertEqual(titles, {"P1", "P2"})

    def test_add_sticker_to_pack(self):
        """POST /api/stickers/packs/<id>/stickers/ adds a sticker."""
        pack = StickerSet.objects.create(owner=self.user, title="P", short_name="p")
        f = _create_file(self.user, "sticker.png", "image/png")

        res = self.client.post(
            f"/api/stickers/packs/{pack.id}/stickers/",
            {"file_id": str(f.id), "emoji": "😀", "label": "Smile"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["emoji"], "😀")
        self.assertEqual(res.data["file_id"], str(f.id))
        self.assertEqual(Sticker.objects.filter(pack=pack).count(), 1)

    def test_add_sticker_requires_own_file(self):
        """Adding sticker requires file owned by user."""
        pack = StickerSet.objects.create(owner=self.user, title="P", short_name="p")
        f = _create_file(self.other_user, "other.png", "image/png")

        res = self.client.post(
            f"/api/stickers/packs/{pack.id}/stickers/",
            {"file_id": str(f.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 404)

    def test_install_uninstall_pack(self):
        """Install and uninstall a pack."""
        pack = StickerSet.objects.create(owner=self.user, title="P", short_name="p")

        res = self.client.post("/api/stickers/install/", {"stickerset_id": str(pack.id)}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(UserStickerSet.objects.filter(user=self.user, stickerset=pack).exists())

        res = self.client.post("/api/stickers/uninstall/", {"stickerset_id": str(pack.id)}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(UserStickerSet.objects.filter(user=self.user, stickerset=pack).exists())

    def test_list_installed(self):
        """GET /api/stickers/installed/ returns installed packs."""
        pack = StickerSet.objects.create(owner=self.user, title="P", short_name="p")
        UserStickerSet.objects.create(user=self.user, stickerset=pack, order=0)

        res = self.client.get("/api/stickers/installed/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["title"], "P")

    def test_recent(self):
        """Save and list recent stickers."""
        pack = StickerSet.objects.create(owner=self.user, title="P", short_name="p")
        f = _create_file(self.user, "s.png", "image/png")
        sticker = Sticker.objects.create(pack=pack, file=f, emoji="😀")

        res = self.client.post(
            "/api/stickers/save-recent/",
            {"sticker_id": str(sticker.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(RecentSticker.objects.filter(user=self.user, sticker=sticker).exists())

        res = self.client.get("/api/stickers/recent/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["id"], str(sticker.id))
