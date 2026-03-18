/**
 * Stream encryption/decryption for files using XChaCha20-Poly1305.
 * Chunk size 64 KB.
 */

import {
  cryptoAeadXChaCha20Poly1305IetfEncrypt,
  cryptoAeadXChaCha20Poly1305IetfDecrypt,
  randomBytes,
  toBase64,
  fromBase64,
} from "./crypto";

const CHUNK_SIZE = 64 * 1024;
const NONCE_LEN = 24;

/** Encrypt file to ciphertext blob. Pads last chunk to CHUNK_SIZE for fixed structure. */
export async function encryptFile(file: File): Promise<{ ciphertext: string; key: string; originalSize: number }> {
  const key = randomBytes(32);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const originalSize = file.size;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    let chunkBytes = new Uint8Array(await chunk.arrayBuffer());
    if (chunkBytes.length < CHUNK_SIZE) {
      const padded = new Uint8Array(CHUNK_SIZE);
      padded.set(chunkBytes, 0);
      chunkBytes = padded;
    }
    const nonce = randomBytes(NONCE_LEN);
    const encrypted = cryptoAeadXChaCha20Poly1305IetfEncrypt(
      chunkBytes,
      null,
      nonce,
      key
    );
    const block = new Uint8Array(NONCE_LEN + encrypted.length);
    block.set(nonce, 0);
    block.set(encrypted, NONCE_LEN);
    chunks.push(block);
    offset += CHUNK_SIZE;
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return { ciphertext: toBase64(result), key: toBase64(key), originalSize };
}

const CIPHER_CHUNK_SIZE = CHUNK_SIZE + 16;

/** Decrypt ciphertext blob with key. originalSize truncates final chunk. */
export async function decryptFile(
  ciphertextBase64: string,
  keyBase64: string,
  originalSize: number
): Promise<Blob> {
  const key = fromBase64(keyBase64);
  const data = fromBase64(ciphertextBase64);
  const chunks: Uint8Array[] = [];
  let pos = 0;

  while (pos < data.length) {
    const nonce = data.slice(pos, pos + NONCE_LEN);
    pos += NONCE_LEN;
    const cipherChunk = data.slice(pos, pos + CIPHER_CHUNK_SIZE);
    pos += cipherChunk.length;
    const decrypted = cryptoAeadXChaCha20Poly1305IetfDecrypt(
      cipherChunk,
      null,
      nonce,
      key
    );
    chunks.push(decrypted);
  }

  const totalLen = Math.min(
    chunks.reduce((s, c) => s + c.length, 0),
    originalSize
  );
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    const toCopy = Math.min(c.length, totalLen - off);
    result.set(c.subarray(0, toCopy), off);
    off += toCopy;
    if (off >= totalLen) break;
  }
  return new Blob([result]);
}
