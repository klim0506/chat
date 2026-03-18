"""
Custom EncryptedTextField — transparent server-side encryption.

Fernet ciphertext (base64) is stored in the database.
Data is automatically decrypted when read through the ORM.
If the encryption key is not configured, the field behaves like a regular TextField.

The key is obtained via the KMS module (kms.py):
  - DEV:  directly from MESSAGE_ENCRYPTION_KEY
  - PROD: decrypted via a KMS provider (AWS, Yandex, Vault)
"""

from django.db import models

_fernet = None
_fernet_loaded = False


def _get_fernet():
    """Lazily create a Fernet instance on first call. If key is missing or invalid, returns None (no encryption)."""
    global _fernet, _fernet_loaded
    if _fernet_loaded:
        return _fernet
    from .kms import get_encryption_key
    import logging
    key = get_encryption_key()
    if key:
        try:
            from cryptography.fernet import Fernet
            _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        except Exception as e:
            logging.getLogger(__name__).warning("Fernet key invalid or missing — encryption disabled: %s", e)
            _fernet = None
    else:
        _fernet = None
    _fernet_loaded = True
    return _fernet


def encrypt_value(value: str) -> str:
    """Encrypt a string. If no key is configured, return as-is."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(value: str) -> str:
    """Decrypt a string. If decryption fails, return as-is (for legacy unencrypted data)."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    try:
        return f.decrypt(value.encode("utf-8")).decode("utf-8")
    except Exception:
        # Not a Fernet token (legacy unencrypted data) — return as-is
        return value


class EncryptedTextField(models.TextField):
    """
    TextField that stores data in encrypted form (Fernet / AES-128-CBC).

    - get_prep_value(): called on DB write → encrypts
    - from_db_value(): called on DB read → decrypts
    - Migrations: Django sees this as a regular TextField (deconstruct returns TextField)
    """

    def get_prep_value(self, value):
        """Encrypt before writing to DB."""
        value = super().get_prep_value(value)
        if value is None:
            return value
        return encrypt_value(str(value))

    def from_db_value(self, value, expression, connection):
        """Decrypt when reading from DB."""
        if value is None:
            return value
        return decrypt_value(value)

    def deconstruct(self):
        """
        For migrations: represent the field as a regular TextField
        to avoid generating unnecessary migrations during refactoring.
        """
        name, path, args, kwargs = super().deconstruct()
        return name, "django.db.models.TextField", args, kwargs
