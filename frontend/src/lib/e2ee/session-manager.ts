/**
 * Manages E2EE sessions per remote device.
 * Combines X3DH (initiator) + Double Ratchet.
 */

import { init, toBase64, fromBase64 } from "./crypto";
import { x3dhInitiate, verifySignedPrekey, x3dhRespond } from "./x3dh";
import {
  createRatchetState,
  ratchetEncrypt,
  ratchetDecrypt,
  type RatchetState,
} from "./ratchet";
import * as keyStorage from "./key-storage";
import type { KeyPair } from "./protocol";
import type { KeyBundleDevice } from "./protocol";
import { MSG_TYPE_PREKEY, MSG_TYPE_WHISPER } from "./protocol";

export interface EncryptResult {
  type: 0 | 1;
  body: string;
}

/** Encrypt plaintext for a remote device. Creates session via X3DH if needed. */
export async function encryptForDevice(
  remoteUserId: string,
  remoteDeviceId: number,
  bundle: KeyBundleDevice,
  plaintext: string
): Promise<EncryptResult> {
  await init();

  let state = await keyStorage.getSession(remoteUserId, remoteDeviceId);

  if (!state) {
    const identity = await keyStorage.getIdentityKeyPair();
    if (!identity) throw new Error("No local identity key");
    const { sharedSecret } = x3dhInitiate(identity, null, bundle);
    if (!verifySignedPrekey(bundle)) {
      throw new Error("Invalid signed prekey signature");
    }
    state = createRatchetState(sharedSecret, true);
    await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);
  }

  const plainBytes = new TextEncoder().encode(plaintext);
  const body = ratchetEncrypt(state, plainBytes);
  await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);

  return { type: MSG_TYPE_WHISPER as 1, body };
}

/** Initiate new session (first message) - returns PreKey message. */
export async function initiateSession(
  remoteUserId: string,
  remoteDeviceId: number,
  bundle: KeyBundleDevice,
  plaintext: string
): Promise<{ type: 0; body: string; identity_key: string; ephemeral_key: string; spk_id: number; opk_id?: number }> {
  await init();

  const identity = await keyStorage.getIdentityKeyPair();
  if (!identity) throw new Error("No local identity key");
  if (!verifySignedPrekey(bundle)) {
    throw new Error("Invalid signed prekey signature");
  }

  const { sharedSecret, ephemeralKey } = x3dhInitiate(identity, null, bundle);
  const state = createRatchetState(sharedSecret, true);
  await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);

  const plainBytes = new TextEncoder().encode(plaintext);
  const body = ratchetEncrypt(state, plainBytes);
  await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);

  return {
    type: MSG_TYPE_PREKEY,
    body,
    identity_key: toBase64(identity.publicKey),
    ephemeral_key: toBase64(ephemeralKey.publicKey),
    spk_id: bundle.signed_prekey_id,
    opk_id: bundle.one_time_prekey?.key_id,
  };
}

/** Decrypt PreKey or Whisper message. */
export async function decryptFromDevice(
  remoteUserId: string,
  remoteDeviceId: number,
  type: 0 | 1,
  body: string,
  prekeyPayload?: {
    identity_key: string;
    ephemeral_key: string;
    spk_id: number;
    opk_id?: number;
  }
): Promise<string> {
  await init();

  if (type === MSG_TYPE_PREKEY && prekeyPayload) {
    const identity = await keyStorage.getIdentityKeyPair();
    const spk = await keyStorage.getSignedPreKey(prekeyPayload.spk_id);
    let opk: KeyPair | null = null;
    if (prekeyPayload.opk_id != null) {
      opk = await keyStorage.getPreKey(prekeyPayload.opk_id);
      if (opk) await keyStorage.deletePreKey(prekeyPayload.opk_id);
    }
    if (!identity || !spk) {
      throw new Error("Missing keys for PreKey decrypt");
    }
    const sharedSecret = x3dhRespond(
      identity,
      { publicKey: spk.publicKey, privateKey: spk.privateKey },
      opk,
      fromBase64(prekeyPayload.identity_key),
      fromBase64(prekeyPayload.ephemeral_key),
      prekeyPayload.opk_id
    );
    const state = createRatchetState(sharedSecret, false);
    const plainBytes = ratchetDecrypt(state, body);
    await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);
    return new TextDecoder().decode(plainBytes);
  }

  const state = await keyStorage.getSession(remoteUserId, remoteDeviceId);
  if (!state) throw new Error("No session for decrypt");
  const plainBytes = ratchetDecrypt(state, body);
  await keyStorage.saveSession(remoteUserId, remoteDeviceId, state);
  return new TextDecoder().decode(plainBytes);
}
