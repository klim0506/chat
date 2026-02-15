"""
Кастомное поле EncryptedTextField — прозрачное серверное шифрование.

В базе данных хранится Fernet-шифротекст (base64).
При чтении через ORM данные расшифровываются автоматически.
Если ключ шифрования не настроен — поле ведёт себя как обычный TextField.

Ключ получается через KMS-модуль (kms.py):
  - DEV:  напрямую из MESSAGE_ENCRYPTION_KEY
  - PROD: расшифровывается через KMS-провайдер (AWS, Yandex, Vault)
"""

from django.db import models

_fernet = None
_fernet_loaded = False


def _get_fernet():
    """Лениво создаём Fernet-инстанс при первом вызове."""
    global _fernet, _fernet_loaded
    if _fernet_loaded:
        return _fernet
    from .kms import get_encryption_key
    key = get_encryption_key()
    if key:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    _fernet_loaded = True
    return _fernet


def encrypt_value(value: str) -> str:
    """Шифрует строку. Если ключа нет — возвращает как есть."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(value: str) -> str:
    """Расшифровывает строку. Если не удалось — возвращает как есть (для старых данных)."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    try:
        return f.decrypt(value.encode("utf-8")).decode("utf-8")
    except Exception:
        # Не Fernet-токен (старые незашифрованные данные) — вернуть как есть
        return value


class EncryptedTextField(models.TextField):
    """
    TextField, который хранит данные в зашифрованном виде (Fernet / AES-128-CBC).

    - get_prep_value(): вызывается при записи в БД → шифрует
    - from_db_value(): вызывается при чтении из БД → расшифровывает
    - Миграции: Django видит это как обычный TextField (deconstruct возвращает TextField)
    """

    def get_prep_value(self, value):
        """Шифруем перед записью в БД."""
        value = super().get_prep_value(value)
        if value is None:
            return value
        return encrypt_value(str(value))

    def from_db_value(self, value, expression, connection):
        """Расшифровываем при чтении из БД."""
        if value is None:
            return value
        return decrypt_value(value)

    def deconstruct(self):
        """
        Для миграций: представляем поле как обычный TextField,
        чтобы не генерировать лишние миграции при рефакторинге.
        """
        name, path, args, kwargs = super().deconstruct()
        return name, "django.db.models.TextField", args, kwargs
