"""
Chunked upload (Telegram-style): parts 128 KB, server writes to disk, no full file in RAM.
"""
import os

from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIRequestFactory

from apps.users.models import User
from apps.users.jwt_utils import make_access_token
from apps.files.models import ChunkedUploadSession, FileAttachment
from apps.files.views import ChunkedUploadView, CHUNKED_UPLOAD_PART_SIZE


def _chunk_post(user, part: int, total_parts: int, chunk_bytes: bytes, upload_id: str | None = None, filename: str = "doc.pdf"):
    """Call ChunkedUploadView via APIRequestFactory and force_authenticate."""
    data = {
        "part": str(part),
        "total_parts": str(total_parts),
        "file": SimpleUploadedFile("chunk", chunk_bytes, content_type="application/octet-stream"),
    }
    if upload_id:
        data["upload_id"] = upload_id
    if part == 0:
        data["filename"] = filename
    factory = APIRequestFactory()
    req = factory.post("/api/files/upload/chunk/", data, format="multipart")
    from rest_framework.test import force_authenticate
    force_authenticate(req, user=user)
    view = ChunkedUploadView.as_view()
    return view(req)


@override_settings(MEDIA_ROOT="/tmp/chunked_upload_test_media")
class ChunkedUploadTest(TestCase):
    def setUp(self):
        self.media_root = "/tmp/chunked_upload_test_media"
        os.makedirs(self.media_root, exist_ok=True)
        self.user = User.objects.create_user(phone="+79990001122", display_name="Alice")

    def tearDown(self):
        if os.path.isdir(self.media_root):
            for root, _dirs, files in os.walk(self.media_root, topdown=False):
                for f in files:
                    os.unlink(os.path.join(root, f))
                for d in _dirs:
                    os.rmdir(os.path.join(root, d))
            try:
                os.rmdir(self.media_root)
            except OSError:
                pass

    def _post_chunk(self, part: int, total_parts: int, chunk_bytes: bytes, upload_id: str | None = None, filename: str = "doc.pdf"):
        return _chunk_post(self.user, part, total_parts, chunk_bytes, upload_id=upload_id, filename=filename)

    def test_chunked_upload_creates_attachment_and_file(self):
        """3 parts of 128 KB → one FileAttachment, file on disk equals concatenated content."""
        chunk_size = CHUNKED_UPLOAD_PART_SIZE
        total_parts = 3
        chunks = [b"a" * chunk_size, b"b" * chunk_size, b"c" * 1000]  # last part smaller
        expected_content = b"".join(chunks)
        expected_size = len(expected_content)

        res0 = self._post_chunk(0, total_parts, chunks[0])
        self.assertEqual(res0.status_code, 200, res0.data)
        self.assertIn("upload_id", res0.data)
        upload_id = res0.data["upload_id"]

        res1 = self._post_chunk(1, total_parts, chunks[1], upload_id=upload_id)
        self.assertEqual(res1.status_code, 200, res1.data)

        res2 = self._post_chunk(2, total_parts, chunks[2], upload_id=upload_id)
        self.assertEqual(res2.status_code, 201, res2.data)
        self.assertIn("id", res2.data)
        self.assertEqual(res2.data["original_name"], "doc.pdf")
        self.assertEqual(res2.data["size_bytes"], expected_size)

        att = FileAttachment.objects.get(pk=res2.data["id"])
        self.assertEqual(att.uploader_id, self.user.pk)
        self.assertEqual(att.size_bytes, expected_size)
        self.assertEqual(att.original_name, "doc.pdf")

        full_path = os.path.join(self.media_root, att.file_path)
        self.assertTrue(os.path.isfile(full_path), f"File not found: {full_path}")
        with open(full_path, "rb") as f:
            content = f.read()
        self.assertEqual(content, expected_content, "File content mismatch")

        self.assertEqual(ChunkedUploadSession.objects.count(), 0, "Session should be deleted after finish")

    def test_chunked_upload_first_request_requires_part_zero(self):
        """First request without upload_id must have part=0."""
        chunk = b"x" * 1000
        res = self._post_chunk(1, 2, chunk)
        self.assertEqual(res.status_code, 400)
        self.assertIn("part", res.data.get("detail", "").lower() or "")

    def test_chunked_upload_part_size_exceeds_limit_rejected(self):
        """Chunk larger than 128 KB is rejected."""
        chunk = b"x" * (CHUNKED_UPLOAD_PART_SIZE + 1)
        res = self._post_chunk(0, 1, chunk)
        self.assertEqual(res.status_code, 400)
        self.assertIn("КБ", (res.data.get("detail") or ""))

    def test_chunked_upload_unauthorized_rejected(self):
        """Chunk endpoint requires auth (no user on request)."""
        factory = APIRequestFactory()
        data = {
            "part": "0",
            "total_parts": "1",
            "file": SimpleUploadedFile("chunk", b"x", content_type="application/octet-stream"),
            "filename": "x.pdf",
        }
        req = factory.post("/api/files/upload/chunk/", data, format="multipart")
        req.user = None  # anonymous
        view = ChunkedUploadView.as_view()
        res = view(req)
        self.assertIn(res.status_code, (401, 403), "Unauthenticated request must be rejected")

    def test_chunked_upload_single_part_finishes_immediately(self):
        """One part only: first request returns 201 with attachment."""
        chunk = b"single chunk content"
        res = self._post_chunk(0, 1, chunk, filename="one.txt")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn("id", res.data)
        self.assertEqual(res.data["size_bytes"], len(chunk))
        att = FileAttachment.objects.get(pk=res.data["id"])
        full_path = os.path.join(self.media_root, att.file_path)
        with open(full_path, "rb") as f:
            self.assertEqual(f.read(), chunk)
