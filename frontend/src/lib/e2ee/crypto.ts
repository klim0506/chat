/**
 * Wrappers around libsodium for E2EE.
 * All keys and data are Uint8Array; use toBase64/fromBase64 for transport.
 */

import sodiumModule from "libsodium-wrappers-sumo";
import type { KeyPair } from "./protocol";

type Sodium = Awaited<typeof sodiumModule>;
let sodium: Sodium | null = null;

/** Must be called before any crypto operation. */
export async function init(): Promise<void> {
  if (!sodium) {
    await sodiumModule.ready;
    sodium = sodiumModule as Sodium;
  }
}

function s(): Sodium {
  if (!sodium) throw new Error("E2EE crypto not initialized. Call init() first.");
  return sodium;
}

/** Generate Ed25519 keypair (for identity key, used to sign SPK). */
export function cryptoSignKeypair(): KeyPair {
  const kp = s().crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Generate X25519 keypair (for DH: signed prekey, one-time prekey, ephemeral). */
export function cryptoBoxKeypair(): KeyPair {
  const kp = s().crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Sign message with Ed25519 secret key. Returns signature. */
export function cryptoSignDetached(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return s().crypto_sign_detached(message, privateKey);
}

/** Verify Ed25519 signature. */
export function cryptoSignVerifyDetached(sig: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  return s().crypto_sign_verify_detached(sig, message, publicKey);
}

/** X25519 scalar multiplication: shared = scalar_mult(our_sk, their_pk). */
export function cryptoScalarmult(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return s().crypto_scalarmult(privateKey, publicKey);
}

/** Get public key from X25519 private key. */
export function cryptoScalarmultBase(privateKey: Uint8Array): Uint8Array {
  return s().crypto_scalarmult_base(privateKey);
}

/** Convert Ed25519 public key to X25519 for DH. */
export function cryptoSignEd25519PkToCurve25519(ed25519Pk: Uint8Array): Uint8Array {
  return s().crypto_sign_ed25519_pk_to_curve25519(ed25519Pk);
}

/** Convert Ed25519 secret key to X25519 for DH. */
export function cryptoSignEd25519SkToCurve25519(ed25519Sk: Uint8Array): Uint8Array {
  return s().crypto_sign_ed25519_sk_to_curve25519(ed25519Sk);
}

/** XChaCha20-Poly1305 AEAD encrypt. Nonce is 24 bytes (crypto_aead_xchacha20poly1305_ietf_NPUBBYTES). */
export function cryptoAeadXChaCha20Poly1305IetfEncrypt(
  message: Uint8Array,
  additionalData: Uint8Array | null,
  nonce: Uint8Array,
  key: Uint8Array
): Uint8Array {
  return s().crypto_aead_xchacha20poly1305_ietf_encrypt(message, additionalData ?? null, null, nonce, key);
}

/** XChaCha20-Poly1305 AEAD decrypt. */
export function cryptoAeadXChaCha20Poly1305IetfDecrypt(
  ciphertext: Uint8Array,
  additionalData: Uint8Array | null,
  nonce: Uint8Array,
  key: Uint8Array
): Uint8Array {
  return s().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, additionalData ?? null, nonce, key);
}

/** BLAKE2b keyed hash (for KDF). Output 32 bytes. */
export function cryptoGenericHash(len: number, msg: Uint8Array, key: Uint8Array): Uint8Array {
  return s().crypto_generichash(len, msg, key);
}

/** Random bytes. */
export function randomBytes(length: number): Uint8Array {
  return s().randombytes_buf(length);
}

/** Generate random nonce for XChaCha20-Poly1305 (24 bytes). */
export function randomNonce(): Uint8Array {
  return randomBytes(s().crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
}

/** HKDF-style KDF: HKDF-SHA256(ikm, salt, info) -> 32 bytes. We use BLAKE2b keyed. */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array {
  const key = cryptoGenericHash(32, salt, ikm);
  return cryptoGenericHash(32, info, key);
}

export function toBase64(data: Uint8Array): string {
  return s().to_base64(data, s().base64_variants.ORIGINAL);
}

export function fromBase64(str: string): Uint8Array {
  return s().from_base64(str, s().base64_variants.ORIGINAL);
}
