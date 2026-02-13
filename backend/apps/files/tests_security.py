"""
Security regression tests: file token expiry, file_id ownership, path safety.
"""
import time
import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.users.models import User
from apps.users.jwt_utils import make_access_token
from apps.files.models import FileAttachment
from apps.files.views import make_file_token, verify_file_token


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
