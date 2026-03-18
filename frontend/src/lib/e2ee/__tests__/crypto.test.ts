/**
 * Tests for E2EE cryptographic functions.
 * TOTEST §13.2, §13.3
 *
 * Uses real libsodium-wrappers-sumo. The vitest.config.ts aliases the
 * ESM entry to CJS to work around Cyrillic-path issues on Windows.
 *
 * Runs in Node environment (not jsdom) to avoid cross-realm Uint8Array
 * incompatibility between jsdom and the CJS libsodium build.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  init,
  cryptoSignKeypair,
  cryptoBoxKeypair,
  cryptoAeadXChaCha20Poly1305IetfEncrypt,
  cryptoAeadXChaCha20Poly1305IetfDecrypt,
  randomNonce,
  randomBytes,
  cryptoSignDetached,
  cryptoSignVerifyDetached,
  hkdf,
  toBase64,
  fromBase64,
} from "../crypto";

beforeAll(async () => {
  await init();
});

describe("key generation", () => {
  it("generates Ed25519 keypair with correct key lengths", () => {
    const kp = cryptoSignKeypair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(64); // Ed25519 sk is 64 bytes
  });

  it("generates X25519 keypair with correct key lengths", () => {
    const kp = cryptoBoxKeypair();
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it("generates distinct keypairs on each call", () => {
    const kp1 = cryptoBoxKeypair();
    const kp2 = cryptoBoxKeypair();
    expect(toBase64(kp1.publicKey)).not.toBe(toBase64(kp2.publicKey));
  });
});

/** Helper: convert a string to a Uint8Array that CJS libsodium accepts.
 * The CJS build's type-check rejects jsdom's TextEncoder output,
 * so we use Buffer.from() which produces a proper Uint8Array subclass. */
function u8(str: string): Uint8Array {
  return Buffer.from(str, "utf-8");
}

describe("XChaCha20-Poly1305 encrypt/decrypt", () => {
  it("roundtrip: encrypt then decrypt returns original plaintext", () => {
    const key = randomBytes(32);
    const nonce = randomNonce();
    const plaintext = u8("Hello, E2EE!");

    const ciphertext = cryptoAeadXChaCha20Poly1305IetfEncrypt(plaintext, null, nonce, key);
    expect(ciphertext.length).toBeGreaterThan(plaintext.length); // ciphertext + tag

    const decrypted = cryptoAeadXChaCha20Poly1305IetfDecrypt(ciphertext, null, nonce, key);
    expect(new TextDecoder().decode(decrypted)).toBe("Hello, E2EE!");
  });

  it("decrypt with wrong key throws", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const nonce = randomNonce();
    const plaintext = u8("secret");
    const ciphertext = cryptoAeadXChaCha20Poly1305IetfEncrypt(plaintext, null, nonce, key);

    expect(() =>
      cryptoAeadXChaCha20Poly1305IetfDecrypt(ciphertext, null, nonce, wrongKey)
    ).toThrow();
  });

  it("additional data must match for decryption", () => {
    const key = randomBytes(32);
    const nonce = randomNonce();
    const plaintext = u8("aad-test");
    const ad = u8("associated");
    const ciphertext = cryptoAeadXChaCha20Poly1305IetfEncrypt(plaintext, ad, nonce, key);

    // Correct AD
    const decrypted = cryptoAeadXChaCha20Poly1305IetfDecrypt(ciphertext, ad, nonce, key);
    expect(new TextDecoder().decode(decrypted)).toBe("aad-test");

    // Wrong AD
    expect(() =>
      cryptoAeadXChaCha20Poly1305IetfDecrypt(ciphertext, u8("wrong"), nonce, key)
    ).toThrow();
  });
});

describe("Ed25519 signing", () => {
  it("sign and verify roundtrip", () => {
    const kp = cryptoSignKeypair();
    const message = u8("verify me");
    const sig = cryptoSignDetached(message, kp.privateKey);
    expect(sig.length).toBe(64);
    expect(cryptoSignVerifyDetached(sig, message, kp.publicKey)).toBe(true);
  });

  it("verification fails with wrong key", () => {
    const kp1 = cryptoSignKeypair();
    const kp2 = cryptoSignKeypair();
    const message = u8("only for kp1");
    const sig = cryptoSignDetached(message, kp1.privateKey);
    expect(cryptoSignVerifyDetached(sig, message, kp2.publicKey)).toBe(false);
  });
});

describe("HKDF", () => {
  it("deterministic: same inputs produce same output", () => {
    const ikm = randomBytes(32);
    const salt = randomBytes(32);
    const info = u8("session-key");

    const key1 = hkdf(ikm, salt, info);
    const key2 = hkdf(ikm, salt, info);
    expect(toBase64(key1)).toBe(toBase64(key2));
  });

  it("different inputs produce different output", () => {
    const ikm = randomBytes(32);
    const salt = randomBytes(32);
    const key1 = hkdf(ikm, salt, u8("a"));
    const key2 = hkdf(ikm, salt, u8("b"));
    expect(toBase64(key1)).not.toBe(toBase64(key2));
  });
});

describe("base64 encoding", () => {
  it("roundtrip", () => {
    const data = randomBytes(48);
    const encoded = toBase64(data);
    const decoded = fromBase64(encoded);
    expect(toBase64(decoded)).toBe(encoded);
  });
});
