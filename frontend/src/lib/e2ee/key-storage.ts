/**
 * CRUD for E2EE keys and sessions in IndexedDB.
 */

import { db } from "../db";
import type { KeyPair } from "./protocol";
import type { RatchetState } from "./ratchet";
import { toBase64, fromBase64 } from "./crypto";
import { serializeRatchetState, deserializeRatchetState } from "./ratchet";

const IDENTITY_KEY_ID = "local";

export async function getIdentityKeyPair(): Promise<KeyPair | null> {
  const row = await db.identityKeyPair.get(IDENTITY_KEY_ID);
  if (!row) return null;
  return {
    publicKey: fromBase64(row.publicKey),
    privateKey: fromBase64(row.privateKey),
  };
}

export async function saveIdentityKeyPair(pair: KeyPair): Promise<void> {
  await db.identityKeyPair.put({
    id: IDENTITY_KEY_ID,
    publicKey: toBase64(pair.publicKey),
    privateKey: toBase64(pair.privateKey),
  });
}

export async function getSignedPreKey(keyId: number): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array; signature: Uint8Array } | null> {
  const row = await db.signedPreKeys.get(keyId);
  if (!row) return null;
  return {
    publicKey: fromBase64(row.publicKey),
    privateKey: fromBase64(row.privateKey),
    signature: fromBase64(row.signature),
  };
}

export async function saveSignedPreKey(
  keyId: number,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
  signature: Uint8Array
): Promise<void> {
  await db.signedPreKeys.put({
    keyId,
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
    signature: toBase64(signature),
    createdAt: Date.now(),
  });
}

export async function getPreKey(keyId: number): Promise<KeyPair | null> {
  const row = await db.preKeys.get(keyId);
  if (!row) return null;
  return {
    publicKey: fromBase64(row.publicKey),
    privateKey: fromBase64(row.privateKey),
  };
}

export async function savePreKeys(keys: { keyId: number; publicKey: Uint8Array; privateKey: Uint8Array }[]): Promise<void> {
  await db.preKeys.bulkPut(
    keys.map((k) => ({
      keyId: k.keyId,
      publicKey: toBase64(k.publicKey),
      privateKey: toBase64(k.privateKey),
    }))
  );
}

export async function deletePreKey(keyId: number): Promise<void> {
  await db.preKeys.delete(keyId);
}

export async function getUnusedPreKeyCount(): Promise<number> {
  return db.preKeys.count();
}

export async function getNextPreKeyId(): Promise<number> {
  const last = await db.preKeys.orderBy("keyId").last();
  return last ? last.keyId + 1 : 0;
}

export function sessionId(remoteUserId: string, remoteDeviceId: number): string {
  return `${remoteUserId}:${remoteDeviceId}`;
}

export async function getSession(remoteUserId: string, remoteDeviceId: number): Promise<RatchetState | null> {
  const id = sessionId(remoteUserId, remoteDeviceId);
  const row = await db.sessions.get(id);
  if (!row || !row.ratchetState) return null;
  return deserializeRatchetState(row.ratchetState);
}

export async function saveSession(
  remoteUserId: string,
  remoteDeviceId: number,
  state: RatchetState
): Promise<void> {
  const id = sessionId(remoteUserId, remoteDeviceId);
  const now = Date.now();
  await db.sessions.put({
    id,
    remoteUserId,
    remoteDeviceId,
    ratchetState: serializeRatchetState(state),
    createdAt: 0,
    updatedAt: now,
  });
}

export async function getCurrentDeviceId(): Promise<number | null> {
  const stored = localStorage.getItem("e2ee_device_id");
  if (stored) return parseInt(stored, 10);
  return null;
}

export async function setCurrentDeviceId(deviceId: number): Promise<void> {
  localStorage.setItem("e2ee_device_id", String(deviceId));
}
