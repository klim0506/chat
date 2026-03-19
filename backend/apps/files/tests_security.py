"""
Security regression tests: file token expiry, file_id ownership, path safety.
Plan limits: daily upload limit for free users.
"""
import time
import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.chats.models import Chat, ChatMember, DEFAULT_MAX_MEMBERS, Message
from apps.files.access_handles import make_file_handle
from apps.users.models import User
from apps.users.jwt_utils import make_access_token
from apps.files.models import FileAttachment
from apps.files.views import make_file_token, verify_file_token
from apps.payments.plan_limits import FREE_DAILY_FILE_UPLOADS, get_max_daily_file_uploads


class FileTokenSecurityTest(TestCase):
    """Проверка HMAC-токена доступа к файлам: срок действия и подпись."""

    def test_valid_token_verifies(self):
        file_id = str(uuid.uuid4())
        token = make_file_token(file_id)
        self.assertTrue(verify_file_token(file_id, token))

    def test_expired_token_rejected(self):
        file_id = str(uuid.uuid4())
        expires_at = int(time.time()) - 10
        token = make_file_token(file_id, expires_at=expires_at)
        self.assertFalse(verify_file_token(file_id, token))

    def test_wrong_signature_rejected(self):
        file_id = str(uuid.uuid4())
        token = make_file_token(file_id)
        tampered = token.split(".")[0] + ".a" * 32
        self.assertFalse(verify_file_token(file_id, tampered))

    def test_different_file_id_rejected(self):
        file_id = str(uuid.uuid4())
        token = make_file_token(file_id)
        self.assertFalse(verify_file_token(str(uuid.uuid4()), token))


class FileUploadAccessTest(TestCase):
    """Проверка доступа к загрузке и привязке только своих файлов."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+79990001122", display_name="Alice")
        self.other = User.objects.create_user(phone="+79991112233", display_name="Bob")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_access_token(self.user.pk)}")

    def test_upload_requires_auth(self):
        """Загрузка без токена — 401."""
        client = APIClient()
        res = client.post("/api/files/upload/", {"file": b"x"}, format="multipart")
        self.assertEqual(res.status_code, 401)

    def test_serve_without_token_returns_403(self):
        """Доступ к файлу без query-токена — 403."""
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="x.jpg",
            file_path="chat_uploads/test/x.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
        )
        res = self.client.get(f"/api/files/{att.id}/")
        self.assertEqual(res.status_code, 403)

    def test_serve_with_expired_token_returns_403(self):
        """Просроченный токен — 403."""
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="x.jpg",
            file_path="chat_uploads/test/x.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
        )
        expired_token = make_file_token(str(att.id), expires_at=int(time.time()) - 3600)
        res = self.client.get(f"/api/files/{att.id}/", {"t": expired_token})
        self.assertEqual(res.status_code, 403)

class FileScanGateTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+79990009999", display_name="Scan")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_access_token(self.user.pk)}")

    def test_serve_pending_scan_returns_423(self):
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="x.jpg",
            file_path="chat_uploads/test/x.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
            scan_status=FileAttachment.ScanStatus.PENDING,
        )
        token = make_file_token(str(att.id))
        res = self.client.get(f"/api/files/{att.id}/", {"t": token})
        self.assertEqual(res.status_code, 423)

    def test_serve_infected_returns_403(self):
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="x.jpg",
            file_path="chat_uploads/test/x.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
            scan_status=FileAttachment.ScanStatus.INFECTED,
        )
        token = make_file_token(str(att.id))
        res = self.client.get(f"/api/files/{att.id}/", {"t": token})
        self.assertEqual(res.status_code, 403)


class FileDailyLimitTest(TestCase):
    """Бесплатный пользователь: лимит загрузок в день (20), 21-я — 403."""

    def setUp(self):
        self.user = User.objects.create_user(phone="+79990007777", display_name="FreeUser")
        # без подписки — лимит 20 в день
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_access_token(self.user.pk)}")

    def test_free_user_daily_limit_returns_403_after_20(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        today = timezone.now().date()
        for i in range(FREE_DAILY_FILE_UPLOADS):
            FileAttachment.objects.create(
                uploader=self.user,
                original_name=f"f{i}.txt",
                file_path=f"chat_uploads/uploads/f{i}.txt",
                mime_type="text/plain",
                size_bytes=1,
                storage_type=FileAttachment.StorageType.LOCAL,
                created_at=timezone.now(),
            )
        self.assertEqual(FileAttachment.objects.filter(uploader=self.user, created_at__date=today).count(), FREE_DAILY_FILE_UPLOADS)
        self.assertEqual(get_max_daily_file_uploads(self.user), FREE_DAILY_FILE_UPLOADS)

        f = SimpleUploadedFile("extra.txt", b"x", content_type="text/plain")
        res = self.client.post("/api/files/upload/", {"file": f}, format="multipart")
        self.assertEqual(res.status_code, 403, res.data)
        self.assertEqual(res.data.get("code"), "plan_restriction")


class MediaAccessBrokerSecurityTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone="+79990001234", display_name="Owner")
        self.member = User.objects.create_user(phone="+79990005678", display_name="Member")
        self.outsider = User.objects.create_user(phone="+79990009998", display_name="Outsider")
        self.chat = Chat.objects.create(
            title="Sec",
            slug="sec-chat",
            verification_code="sec-code",
            chat_type=Chat.ChatType.OPEN,
            max_members=DEFAULT_MAX_MEMBERS,
            owner=self.owner,
        )
        ChatMember.objects.create(chat=self.chat, user=self.owner, role=ChatMember.Role.ADMIN, status=ChatMember.Status.ACTIVE)
        ChatMember.objects.create(chat=self.chat, user=self.member, role=ChatMember.Role.MEMBER, status=ChatMember.Status.ACTIVE)
        self.attachment = FileAttachment.objects.create(
            uploader=self.owner,
            original_name="doc.pdf",
            file_path="chat_uploads/test/doc.pdf",
            mime_type="application/pdf",
            size_bytes=128,
            storage_type=FileAttachment.StorageType.LOCAL,
        )
        self.message = Message.objects.create(
            chat=self.chat,
            sender=self.owner,
            msg_type=Message.MsgType.FILE,
            content="doc",
            file=self.attachment,
        )
        self.message.files.set([self.attachment])

    def _auth(self, user: User) -> APIClient:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {make_access_token(user.pk)}")
        return client

    def test_broker_requires_auth(self):
        client = APIClient()
        res = client.get("/api/media/access/", {"handle": make_file_handle(self.attachment.id)})
        self.assertEqual(res.status_code, 401)

    def test_broker_denies_non_member(self):
        res = self._auth(self.outsider).get("/api/media/access/", {"handle": make_file_handle(self.attachment.id)})
        self.assertEqual(res.status_code, 403)

    def test_broker_denies_after_leaving_chat(self):
        member_client = self._auth(self.member)
        first = member_client.get("/api/media/access/", {"handle": make_file_handle(self.attachment.id)})
        self.assertEqual(first.status_code, 200, first.data)
        ChatMember.objects.filter(chat=self.chat, user=self.member).delete()
        second = member_client.get("/api/media/access/", {"handle": make_file_handle(self.attachment.id)})
        self.assertEqual(second.status_code, 403)

    def test_handle_does_not_expose_file_path(self):
        handle = make_file_handle(self.attachment.id)
        self.assertNotIn("chat_uploads", handle)
        self.assertNotIn("MEDIA_ROOT", handle)
        self.assertNotIn(str(self.attachment.file_path), handle)
