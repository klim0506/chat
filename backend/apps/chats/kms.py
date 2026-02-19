"""
Key Management Service (KMS) — message encryption key retrieval.

Operating modes (configured via environment variables):

1. DEV / test: MESSAGE_ENCRYPTION_KEY is set directly in .env
   → the key is used as-is, no KMS needed.

2. PROD: KMS_PROVIDER + MESSAGE_ENCRYPTION_KEY_ENCRYPTED
   → the encrypted key (DEK) is decrypted via KMS at application startup.
   → the plaintext key lives only in memory, never written to disk.

Supported KMS providers:
  - aws       — AWS KMS (requires boto3)
  - yandex    — Yandex Cloud KMS (requires requests + IAM token)
  - vault     — HashiCorp Vault Transit (requires requests)
"""

import base64
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_cached_key: str | None = None
_cached_loaded = False


def get_encryption_key() -> str:
    """
    Return the Fernet message encryption key.

    Priority:
    1. If MESSAGE_ENCRYPTION_KEY is set — use it directly (dev mode).
    2. If KMS_PROVIDER is set — decrypt MESSAGE_ENCRYPTION_KEY_ENCRYPTED via KMS.
    3. Otherwise — empty string (encryption disabled).
    """
    global _cached_key, _cached_loaded
    if _cached_loaded:
        return _cached_key or ""

    # 1. Direct key (dev / test)
    direct_key = getattr(settings, "MESSAGE_ENCRYPTION_KEY", "")
    if direct_key:
        _cached_key = direct_key
        _cached_loaded = True
        logger.info("Encryption key loaded from MESSAGE_ENCRYPTION_KEY (direct).")
        return _cached_key

    # 2. KMS provider (prod)
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

    # 3. Encryption disabled
    _cached_loaded = True
    _cached_key = ""
    logger.warning("No MESSAGE_ENCRYPTION_KEY or KMS_PROVIDER configured — encryption disabled.")
    return ""


def _decrypt_via_kms(provider: str, encrypted_key_b64: str) -> str:
    """Route the encrypted DEK to the appropriate KMS provider for decryption."""
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
    Decrypt via AWS KMS.

    Environment variables:
      KMS_AWS_KEY_ID   — ARN or alias of the KMS key
      AWS_REGION       — region (default us-east-1)
      + standard AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY or IAM role)
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
    Decrypt via Yandex Cloud KMS.

    Environment variables:
      KMS_YANDEX_KEY_ID    — key ID in Yandex KMS
      KMS_YANDEX_IAM_TOKEN — IAM token (or service account on VM)
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
    Decrypt via HashiCorp Vault Transit secrets engine.

    Environment variables:
      KMS_VAULT_ADDR     — Vault URL (e.g. https://vault.example.com)
      KMS_VAULT_TOKEN    — authorization token
      KMS_VAULT_KEY_NAME — Transit key name
      KMS_VAULT_MOUNT    — mount path (default 'transit')
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

    # Vault Transit expects ciphertext in the format vault:v1:base64...
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
