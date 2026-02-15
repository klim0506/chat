"""
Key Management Service (KMS) — получение ключа шифрования сообщений.

Режимы работы (настройка через переменные окружения):

1. DEV / тест: MESSAGE_ENCRYPTION_KEY задан напрямую в .env
   → ключ используется как есть, KMS не нужен.

2. PROD: KMS_PROVIDER + MESSAGE_ENCRYPTION_KEY_ENCRYPTED
   → зашифрованный ключ (DEK) расшифровывается через KMS при старте приложения.
   → открытый ключ живёт только в памяти, никогда не попадает на диск.

Поддерживаемые KMS-провайдеры:
  - aws       — AWS KMS (требует boto3)
  - yandex    — Yandex Cloud KMS (требует requests + IAM-токен)
  - vault     — HashiCorp Vault Transit (требует requests)
"""

import base64
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_cached_key: str | None = None
_cached_loaded = False


def get_encryption_key() -> str:
    """
    Возвращает Fernet-ключ шифрования сообщений.

    Порядок:
    1. Если MESSAGE_ENCRYPTION_KEY задан — используем напрямую (dev-режим).
    2. Если KMS_PROVIDER задан — расшифровываем MESSAGE_ENCRYPTION_KEY_ENCRYPTED через KMS.
    3. Иначе — пустая строка (шифрование отключено).
    """
    global _cached_key, _cached_loaded
    if _cached_loaded:
        return _cached_key or ""

    # 1. Прямой ключ (dev / тест)
    direct_key = getattr(settings, "MESSAGE_ENCRYPTION_KEY", "")
    if direct_key:
        _cached_key = direct_key
        _cached_loaded = True
        logger.info("Encryption key loaded from MESSAGE_ENCRYPTION_KEY (direct).")
        return _cached_key

    # 2. KMS-провайдер (prod)
    provider = getattr(settings, "KMS_PROVIDER", "")
    encrypted_key = getattr(settings, "MESSAGE_ENCRYPTION_KEY_ENCRYPTED", "")

    if provider and encrypted_key:
        try:
            _cached_key = _decrypt_via_kms(provider, encrypted_key)
            _cached_loaded = True
            logger.info("Encryption key decrypted via KMS provider '%s'.", provider)
            return _cached_key
        except Exception:
            logger.exception("Failed to decrypt encryption key via KMS provider '%s'.", provider)
            raise

    # 3. Шифрование отключено
    _cached_loaded = True
    _cached_key = ""
    logger.warning("No MESSAGE_ENCRYPTION_KEY or KMS_PROVIDER configured — encryption disabled.")
    return ""


def _decrypt_via_kms(provider: str, encrypted_key_b64: str) -> str:
    """Направляет зашифрованный DEK нужному KMS-провайдеру для расшифровки."""
    providers = {
        "aws": _decrypt_aws_kms,
        "yandex": _decrypt_yandex_kms,
        "vault": _decrypt_vault_transit,
    }
    fn = providers.get(provider)
    if fn is None:
        raise ValueError(
            f"Unknown KMS_PROVIDER='{provider}'. "
            f"Supported: {', '.join(providers)}."
        )
    return fn(encrypted_key_b64)


# ── AWS KMS ──────────────────────────────────────────────────────────────────


def _decrypt_aws_kms(encrypted_key_b64: str) -> str:
    """
    Расшифровка через AWS KMS.

    Переменные окружения:
      KMS_AWS_KEY_ID   — ARN или alias ключа KMS
      AWS_REGION       — регион (по умолчанию us-east-1)
      + стандартные AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY или IAM role)
    """
    try:
        import boto3  # type: ignore
    except ImportError as exc:
        raise ImportError(
            "boto3 is required for KMS_PROVIDER='aws'. "
            "Install it: pip install boto3"
        ) from exc

    region = getattr(settings, "KMS_AWS_REGION", "us-east-1")
    key_id = getattr(settings, "KMS_AWS_KEY_ID", "")
    if not key_id:
        raise ValueError("KMS_AWS_KEY_ID must be set when KMS_PROVIDER='aws'.")

    client = boto3.client("kms", region_name=region)
    ciphertext = base64.b64decode(encrypted_key_b64)
    response = client.decrypt(
        CiphertextBlob=ciphertext,
        KeyId=key_id,
    )
    plaintext: bytes = response["Plaintext"]
    return plaintext.decode("utf-8")


# ── Yandex Cloud KMS ────────────────────────────────────────────────────────


def _decrypt_yandex_kms(encrypted_key_b64: str) -> str:
    """
    Расшифровка через Yandex Cloud KMS.

    Переменные окружения:
      KMS_YANDEX_KEY_ID    — ID ключа в Yandex KMS
      KMS_YANDEX_IAM_TOKEN — IAM-токен (или сервисный аккаунт на ВМ)
    """
    try:
        import requests  # type: ignore
    except ImportError as exc:
        raise ImportError(
            "requests is required for KMS_PROVIDER='yandex'. "
            "Install it: pip install requests"
        ) from exc

    key_id = getattr(settings, "KMS_YANDEX_KEY_ID", "")
    iam_token = getattr(settings, "KMS_YANDEX_IAM_TOKEN", "")
    if not key_id:
        raise ValueError("KMS_YANDEX_KEY_ID must be set when KMS_PROVIDER='yandex'.")
    if not iam_token:
        raise ValueError("KMS_YANDEX_IAM_TOKEN must be set when KMS_PROVIDER='yandex'.")

    url = f"https://kms.yandex/kms/v1/keys/{key_id}:decrypt"
    resp = requests.post(
        url,
        json={"ciphertext": encrypted_key_b64},
        headers={"Authorization": f"Bearer {iam_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    plaintext_b64 = resp.json()["plaintext"]
    return base64.b64decode(plaintext_b64).decode("utf-8")


# ── HashiCorp Vault Transit ─────────────────────────────────────────────────


def _decrypt_vault_transit(encrypted_key_b64: str) -> str:
    """
    Расшифровка через HashiCorp Vault Transit secrets engine.

    Переменные окружения:
      KMS_VAULT_ADDR     — URL Vault (например https://vault.example.com)
      KMS_VAULT_TOKEN    — токен авторизации
      KMS_VAULT_KEY_NAME — имя ключа Transit
      KMS_VAULT_MOUNT    — mount path (по умолчанию 'transit')
    """
    try:
        import requests  # type: ignore
    except ImportError as exc:
        raise ImportError(
            "requests is required for KMS_PROVIDER='vault'. "
            "Install it: pip install requests"
        ) from exc

    vault_addr = getattr(settings, "KMS_VAULT_ADDR", "")
    vault_token = getattr(settings, "KMS_VAULT_TOKEN", "")
    key_name = getattr(settings, "KMS_VAULT_KEY_NAME", "")
    mount = getattr(settings, "KMS_VAULT_MOUNT", "transit")

    if not vault_addr or not vault_token or not key_name:
        raise ValueError(
            "KMS_VAULT_ADDR, KMS_VAULT_TOKEN, KMS_VAULT_KEY_NAME must be set "
            "when KMS_PROVIDER='vault'."
        )

    # Vault Transit принимает ciphertext в формате vault:v1:base64...
    ciphertext = f"vault:v1:{encrypted_key_b64}"
    url = f"{vault_addr.rstrip('/')}/v1/{mount}/decrypt/{key_name}"
    resp = requests.post(
        url,
        json={"ciphertext": ciphertext},
        headers={"X-Vault-Token": vault_token},
        timeout=10,
    )
    resp.raise_for_status()
    plaintext_b64 = resp.json()["data"]["plaintext"]
    return base64.b64decode(plaintext_b64).decode("utf-8")
