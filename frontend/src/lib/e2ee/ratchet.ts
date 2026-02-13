/**
 * Double Ratchet state machine (simplified symmetric-key ratchet).
 * Chain KDF: (CK, N) -> (MK, CK_next). Message keys used once.
 */

import {
  cryptoAeadXChaCha20Poly1305IetfEncrypt,
  cryptoAeadXChaCha20Poly1305IetfDecrypt,
  cryptoGenericHash,
  randomNonce,
  toBase64,
  fromBase64,
} from "./crypto";

const RATCHET_INFO = new TextEncoder().encode("DR-v1");
const MESSAGE_KEY_INFO = new TextEncoder().encode("MK");

/** Derive next chain key and message key from current chain key. */
function ratchetStep(ck: Uint8Array): { messageKey: Uint8Array; chainKeyNext: Uint8Array } {
  const msgKeyMaterial = cryptoGenericHash(64, ck, MESSAGE_KEY_INFO);
  return {
    messageKey: msgKeyMaterial.slice(0, 32),
    chainKeyNext: msgKeyMaterial.slice(32, 64),
  };
}

export interface RatchetState {
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array;
  receivingChainKey: Uint8Array | null;
  sendingChainN: number;
  receivingChainN: number;
  /** Skipped message keys for out-of-order: "n" -> key */
  skippedKeys: Map<number, Uint8Array>;
}

export function createRatchetState(sharedSecret: Uint8Array, isInitiator: boolean): RatchetState {
  const initInfo = new Uint8Array([isInitiator ? 1 : 0]);
  const ck = cryptoGenericHash(32, sharedSecret, initInfo);
  return {
    rootKey: sharedSecret,
    sendingChainKey: ck,
    receivingChainKey: isInitiator ? null : ck,
    sendingChainN: 0,
    receivingChainN: 0,
    skippedKeys: new Map(),
  };
}

/** Encrypt a message. Returns { ciphertext, body } for wire format. */
export function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array, ad?: Uint8Array): string {
  const { messageKey, chainKeyNext } = ratchetStep(state.sendingChainKey);
  const nonce = randomNonce();
  const ciphertext = cryptoAeadXChaCha20Poly1305IetfEncrypt(
    plaintext,
    ad ?? null,
    nonce,
    messageKey
  );
  state.sendingChainKey = chainKeyNext;
  state.sendingChainN += 1;
  const body = new Uint8Array(nonce.length + ciphertext.length);
  body.set(nonce, 0);
  body.set(ciphertext, nonce.length);
  return toBase64(body);
}

/** Decrypt a message. Supports in-order only (out-of-order uses skippedKeys if populated). */
export function ratchetDecrypt(state: RatchetState, bodyBase64: string, ad?: Uint8Array): Uint8Array {
  const body = fromBase64(bodyBase64);
  const nonceLen = 24;
  const nonce = body.slice(0, nonceLen);
  const ciphertext = body.slice(nonceLen);

  const n = state.receivingChainN;
  const skipped = state.skippedKeys.get(n);
  let messageKey: Uint8Array;
  let chainKeyNext: Uint8Array;

  if (skipped) {
    messageKey = skipped;
    state.skippedKeys.delete(n);
    if (!state.receivingChainKey) throw new Error("No receiving chain");
    const step = ratchetStep(state.receivingChainKey);
    chainKeyNext = step.chainKeyNext;
  } else {
    if (!state.receivingChainKey) {
      throw new Error("No receiving chain - cannot decrypt");
    }
    const step = ratchetStep(state.receivingChainKey);
    messageKey = step.messageKey;
    chainKeyNext = step.chainKeyNext;
  }

  const plaintext = cryptoAeadXChaCha20Poly1305IetfDecrypt(
    ciphertext,
    ad ?? null,
    nonce,
    messageKey
  );
  state.receivingChainKey = chainKeyNext;
  state.receivingChainN += 1;
  return plaintext;
}

/** Serialize state for storage (Dexie). */
export function serializeRatchetState(state: RatchetState): Record<string, unknown> {
  const skipped: Record<string, string> = {};
  state.skippedKeys.forEach((v, k) => {
    skipped[String(k)] = toBase64(v);
  });
  return {
    rootKey: toBase64(state.rootKey),
    sendingChainKey: toBase64(state.sendingChainKey),
    receivingChainKey: state.receivingChainKey ? toBase64(state.receivingChainKey) : null,
    sendingChainN: state.sendingChainN,
    receivingChainN: state.receivingChainN,
    skippedKeys: skipped,
  };
}

/** Deserialize state from storage. */
export function deserializeRatchetState(raw: Record<string, unknown>): RatchetState {
  const skipped = new Map<number, Uint8Array>();
  const rawSkipped = raw.skippedKeys as Record<string, string> | undefined;
  if (rawSkipped) {
    for (const [k, v] of Object.entries(rawSkipped)) {
      skipped.set(parseInt(k, 10), fromBase64(v));
    }
  }
  return {
    rootKey: fromBase64(raw.rootKey as string),
    sendingChainKey: fromBase64(raw.sendingChainKey as string),
    receivingChainKey: raw.receivingChainKey
      ? fromBase64(raw.receivingChainKey as string)
      : null,
    sendingChainN: (raw.sendingChainN as number) ?? 0,
    receivingChainN: (raw.receivingChainN as number) ?? 0,
    skippedKeys: skipped,
  };
}
