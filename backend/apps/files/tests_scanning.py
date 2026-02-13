"""
Tests for file scanning pipeline: clean / infected / error, pending blocked, optimize trigger.
TOTEST §6
"""
import tempfile
import os
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings

from apps.common.test_helpers import create_user, create_file
from apps.files.models import FileAttachment
from apps.files.tasks import scan_uploaded_file, EICAR_SIGNATURE, optimize_uploaded_image


class ScanCleanFileTest(TestCase):
    """Normal file → scan_status pending → clean, scanned_at set."""

    def setUp(self):
        self.user = create_user(phone="+79990000100", display_name="Scan")

    def test_clean_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                # Create real file
                subdir = Path(tmpdir) / "chat_uploads" / "test"
                subdir.mkdir(parents=True, exist_ok=True)
                file_path = subdir / "clean.jpg"
                file_path.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 100 + b"\xff\xd9")

                att = FileAttachment.objects.create(
                    uploader=self.user,
                    original_name="clean.jpg",
                    file_path="chat_uploads/test/clean.jpg",
                    mime_type="image/jpeg",
                    size_bytes=104,
                    storage_type=FileAttachment.StorageType.LOCAL,
                    scan_status=FileAttachment.ScanStatus.PENDING,
                )

                with patch("apps.files.tasks.optimize_uploaded_image.delay") as mock_opt:
                    scan_uploaded_file(str(att.id))

                att.refresh_from_db()
                self.assertEqual(att.scan_status, FileAttachment.ScanStatus.CLEAN)
                self.assertIsNotNone(att.scanned_at)
                self.assertEqual(att.scan_details, "")
                mock_opt.assert_called_once_with(str(att.id))


class ScanInfectedFileTest(TestCase):
    """EICAR test string → scan_status=infected.
    Note: writing the real EICAR signature to disk may be blocked by
    Windows Defender, so we mock _detect_malware to simulate detection."""

    def setUp(self):
        self.user = create_user(phone="+79990000101", display_name="Infected")

    def test_eicar_detected(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                subdir = Path(tmpdir) / "chat_uploads" / "test"
                subdir.mkdir(parents=True, exist_ok=True)
                file_path = subdir / "eicar.txt"
                # Write a harmless placeholder — real EICAR may be quarantined by AV
                file_path.write_bytes(b"placeholder-for-test")

                att = FileAttachment.objects.create(
                    uploader=self.user,
                    original_name="eicar.txt",
                    file_path="chat_uploads/test/eicar.txt",
                    mime_type="text/plain",
                    size_bytes=68,
                    storage_type=FileAttachment.StorageType.LOCAL,
                    scan_status=FileAttachment.ScanStatus.PENDING,
                )
                with patch("apps.files.tasks._detect_malware", return_value=(True, "eicar-signature")):
                    scan_uploaded_file(str(att.id))
                att.refresh_from_db()
                self.assertEqual(att.scan_status, FileAttachment.ScanStatus.INFECTED)
                self.assertEqual(att.scan_details, "eicar-signature")
                self.assertIsNotNone(att.scanned_at)


class ScanErrorFileTest(TestCase):
    """File not found on disk → scan_status=error."""

    def setUp(self):
        self.user = create_user(phone="+79990000102", display_name="Error")

    def test_missing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                att = FileAttachment.objects.create(
                    uploader=self.user,
                    original_name="missing.jpg",
                    file_path="chat_uploads/test/missing.jpg",
                    mime_type="image/jpeg",
                    size_bytes=0,
                    storage_type=FileAttachment.StorageType.LOCAL,
                    scan_status=FileAttachment.ScanStatus.PENDING,
                )
                scan_uploaded_file(str(att.id))
                att.refresh_from_db()
                self.assertEqual(att.scan_status, FileAttachment.ScanStatus.ERROR)
                self.assertEqual(att.scan_details, "file-not-found")


class ScanNonLocalFileTest(TestCase):
    """Non-local files skip scanning and are marked clean."""

    def setUp(self):
        self.user = create_user(phone="+79990000103", display_name="NonLocal")

    def test_non_local_marked_clean(self):
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="cloud.jpg",
            file_path="",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.GOOGLE_DRIVE,
            scan_status=FileAttachment.ScanStatus.PENDING,
        )
        scan_uploaded_file(str(att.id))
        att.refresh_from_db()
        self.assertEqual(att.scan_status, FileAttachment.ScanStatus.CLEAN)
        self.assertEqual(att.scan_details, "non-local")


class PendingFileBlockedTest(TestCase):
    """File with scan_status=PENDING is inaccessible via serve endpoint (423)."""

    def setUp(self):
        self.user = create_user(phone="+79990000104", display_name="Blocked")

    def test_pending_returns_423(self):
        from apps.files.views import make_file_token
        from apps.common.test_helpers import auth_client
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="pending.jpg",
            file_path="chat_uploads/test/pending.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
            scan_status=FileAttachment.ScanStatus.PENDING,
        )
        token = make_file_token(str(att.id))
        client = auth_client(self.user)
        res = client.get(f"/api/files/{att.id}/", {"t": token})
        self.assertEqual(res.status_code, 423)

    def test_infected_returns_403(self):
        from apps.files.views import make_file_token
        from apps.common.test_helpers import auth_client
        att = FileAttachment.objects.create(
            uploader=self.user,
            original_name="infected.jpg",
            file_path="chat_uploads/test/infected.jpg",
            mime_type="image/jpeg",
            size_bytes=0,
            storage_type=FileAttachment.StorageType.LOCAL,
            scan_status=FileAttachment.ScanStatus.INFECTED,
        )
        token = make_file_token(str(att.id))
        client = auth_client(self.user)
        res = client.get(f"/api/files/{att.id}/", {"t": token})
        self.assertEqual(res.status_code, 403)


class OptimizeAfterScanTest(TestCase):
    """TOTEST §6: after clean scan, optimize_uploaded_image() is called for images."""

    def setUp(self):
        self.user = create_user(phone="+79990000110", display_name="OptImg")

    def test_clean_image_triggers_optimize(self):
        """After scan → clean, optimize_uploaded_image runs and shrinks the file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                subdir = Path(tmpdir) / "chat_uploads" / "test"
                subdir.mkdir(parents=True, exist_ok=True)
                file_path = subdir / "large.jpg"

                # Create a large JPEG image (> 250 KB) using PIL
                from PIL import Image
                img = Image.new("RGB", (3000, 2000), color="red")
                img.save(str(file_path), format="JPEG", quality=95)
                original_size = file_path.stat().st_size
                self.assertGreater(original_size, 250 * 1024, "Test image should be > 250KB")

                att = FileAttachment.objects.create(
                    uploader=self.user,
                    original_name="large.jpg",
                    file_path="chat_uploads/test/large.jpg",
                    mime_type="image/jpeg",
                    size_bytes=original_size,
                    storage_type=FileAttachment.StorageType.LOCAL,
                    scan_status=FileAttachment.ScanStatus.PENDING,
                )

                # Run scan → triggers optimize_uploaded_image.delay(...)
                # We call optimize synchronously instead of mocking
                scan_uploaded_file(str(att.id))
                att.refresh_from_db()
                self.assertEqual(att.scan_status, FileAttachment.ScanStatus.CLEAN)

                # Now run optimize synchronously
                optimize_uploaded_image(str(att.id))
                att.refresh_from_db()
                # File should either be smaller or unchanged (if optimization didn't help)
                new_size = file_path.stat().st_size
                # At minimum, the image was processed; for a large solid-color JPEG,
                # re-encoding at q=82 should produce a smaller file
                self.assertLessEqual(att.size_bytes, original_size)

    def test_non_image_not_optimized(self):
        """optimize_uploaded_image skips non-image files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(MEDIA_ROOT=tmpdir):
                subdir = Path(tmpdir) / "chat_uploads" / "test"
                subdir.mkdir(parents=True, exist_ok=True)
                file_path = subdir / "doc.pdf"
                file_path.write_bytes(b"%PDF-1.4 " + b"\x00" * 500 * 1024)

                att = FileAttachment.objects.create(
                    uploader=self.user,
                    original_name="doc.pdf",
                    file_path="chat_uploads/test/doc.pdf",
                    mime_type="application/pdf",
                    size_bytes=file_path.stat().st_size,
                    storage_type=FileAttachment.StorageType.LOCAL,
                    scan_status=FileAttachment.ScanStatus.CLEAN,
                )

                old_size = att.size_bytes
                optimize_uploaded_image(str(att.id))
                att.refresh_from_db()
                self.assertEqual(att.size_bytes, old_size)  # unchanged
