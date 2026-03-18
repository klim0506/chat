"""
Tests for E2EE API: device registration, prekeys, key bundle, encrypted message fields.
TOTEST §13.1, §13.6
"""
import base64
from django.test import TestCase

from apps.common.test_helpers import (
    create_user, create_chat, add_member, create_message, auth_client,
)
from apps.e2ee.models import Device, OneTimePreKey


def _b64(data: bytes = b"fake-key-data") -> str:
    return base64.b64encode(data).data.decode() if hasattr(base64.b64encode(data), 'data') else base64.b64encode(data).decode()


class DeviceRegistrationTest(TestCase):
    """POST /api/e2ee/devices/ — register device with keys."""

    def setUp(self):
        self.user = create_user(phone="+79990000090", display_name="E2EE")
        self.client = auth_client(self.user)

    def test_register_device(self):
        res = self.client.post(
            "/api/e2ee/devices/",
            {
                "device_id": 1,
                "name": "Chrome",
                "identity_key": _b64(b"ik-data"),
                "signed_prekey": _b64(b"spk-data"),
                "signed_prekey_id": 1,
                "signed_prekey_sig": _b64(b"sig-data"),
                "prekeys": [
                    {"key_id": "1", "public_key": _b64(b"opk-1")},
                    {"key_id": "2", "public_key": _b64(b"opk-2")},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Device.objects.filter(user=self.user, device_id=1).exists())
        self.assertEqual(OneTimePreKey.objects.filter(device__user=self.user).count(), 2)

    def test_list_devices(self):
        Device.objects.create(
            user=self.user, device_id=1, identity_key="ik",
            signed_prekey="spk", signed_prekey_id=1, signed_prekey_sig="sig",
        )
        res = self.client.get("/api/e2ee/devices/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["device_id"], 1)


class PreKeyUploadTest(TestCase):
    """POST /api/e2ee/keys/prekeys/ — upload additional one-time prekeys."""

    def setUp(self):
        self.user = create_user(phone="+79990000091", display_name="PKUser")
        self.client = auth_client(self.user)
        self.device = Device.objects.create(
            user=self.user, device_id=1, identity_key="ik",
            signed_prekey="spk", signed_prekey_id=1, signed_prekey_sig="sig",
        )

    def test_upload_prekeys(self):
        res = self.client.post(
            "/api/e2ee/keys/prekeys/",
            {
                "device_id": 1,
                "prekeys": [
                    {"key_id": "10", "public_key": _b64(b"pk-10")},
                    {"key_id": "11", "public_key": _b64(b"pk-11")},
                    {"key_id": "12", "public_key": _b64(b"pk-12")},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["unused_prekeys_count"], 3)
        self.assertEqual(OneTimePreKey.objects.filter(device=self.device, is_used=False).count(), 3)


class KeyBundleTest(TestCase):
    """GET /api/e2ee/keys/<user_id>/ — returns bundle, OPK marked used."""

    def setUp(self):
        self.target = create_user(phone="+79990000092", display_name="Target")
        self.requester = create_user(phone="+79990000093", display_name="Req")
        self.device = Device.objects.create(
            user=self.target, device_id=1, identity_key="ik-target",
            signed_prekey="spk-target", signed_prekey_id=1, signed_prekey_sig="sig-target",
        )
        self.opk = OneTimePreKey.objects.create(
            device=self.device, key_id=1, public_key="opk-1",
        )

    def test_get_key_bundle(self):
        client = auth_client(self.requester)
        res = client.get(f"/api/e2ee/keys/{self.target.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["devices"]), 1)
        bundle = res.data["devices"][0]
        self.assertEqual(bundle["identity_key"], "ik-target")
        self.assertEqual(bundle["signed_prekey"], "spk-target")
        self.assertIsNotNone(bundle["one_time_prekey"])
        self.assertEqual(bundle["one_time_prekey"]["key_id"], 1)
        # OPK should be marked as used
        self.opk.refresh_from_db()
        self.assertTrue(self.opk.is_used)

    def test_get_key_bundle_no_opk(self):
        """All OPKs used — bundle still returned without OPK."""
        self.opk.is_used = True
        self.opk.save(update_fields=["is_used"])
        client = auth_client(self.requester)
        res = client.get(f"/api/e2ee/keys/{self.target.id}/")
        self.assertEqual(res.status_code, 200)
        bundle = res.data["devices"][0]
        self.assertIsNone(bundle["one_time_prekey"])


class EncryptedMessageFieldsTest(TestCase):
    """Encrypted message: is_encrypted=True, sender_device set, encrypted_keys dict."""

    def setUp(self):
        self.sender = create_user(phone="+79990000094", display_name="EncSender")
        self.receiver = create_user(phone="+79990000095", display_name="EncRecv")
        self.chat = create_chat(self.sender, is_personal=True)
        add_member(self.chat, self.receiver)
        self.device = Device.objects.create(
            user=self.sender, device_id=1, identity_key="ik",
            signed_prekey="spk", signed_prekey_id=1, signed_prekey_sig="sig",
        )

    def test_send_encrypted_message(self):
        client = auth_client(self.sender)
        res = client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {
                "msg_type": "text",
                "content": "cipher-text-blob",
                "is_encrypted": True,
                "encrypted_keys": {"1": "encrypted-key-for-device-1"},
                "sender_device_id": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["is_encrypted"])
        self.assertEqual(res.data["sender_device_id"], 1)
        self.assertIsInstance(res.data["encrypted_keys"], dict)


class MultiDeviceEncryptedKeysTest(TestCase):
    """TOTEST §13.4: encrypted_keys contains key for each registered device of the recipient."""

    def setUp(self):
        self.sender = create_user(phone="+79990000096", display_name="MDSender")
        self.receiver = create_user(phone="+79990000097", display_name="MDRecv")
        self.chat = create_chat(self.sender, is_personal=True)
        add_member(self.chat, self.receiver)

        # Sender has one device
        self.sender_device = Device.objects.create(
            user=self.sender, device_id=1, identity_key="ik-s1",
            signed_prekey="spk-s1", signed_prekey_id=1, signed_prekey_sig="sig-s1",
        )
        # Receiver has TWO devices
        self.recv_device1 = Device.objects.create(
            user=self.receiver, device_id=1, identity_key="ik-r1",
            signed_prekey="spk-r1", signed_prekey_id=1, signed_prekey_sig="sig-r1",
        )
        self.recv_device2 = Device.objects.create(
            user=self.receiver, device_id=2, identity_key="ik-r2",
            signed_prekey="spk-r2", signed_prekey_id=1, signed_prekey_sig="sig-r2",
        )

    def test_encrypted_keys_contains_all_receiver_devices(self):
        """encrypted_keys dict should have entries for every recipient device."""
        client = auth_client(self.sender)
        res = client.post(
            f"/api/chats/{self.chat.id}/messages/",
            {
                "msg_type": "text",
                "content": "multi-device-cipher",
                "is_encrypted": True,
                "encrypted_keys": {
                    "1": "encrypted-key-for-recv-device-1",
                    "2": "encrypted-key-for-recv-device-2",
                },
                "sender_device_id": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        keys = res.data["encrypted_keys"]
        self.assertIsInstance(keys, dict)
        # Both receiver device IDs should be present
        self.assertIn("1", keys)
        self.assertIn("2", keys)
