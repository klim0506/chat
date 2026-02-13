/**
 * Prepare E2EE message payload for sending.
 */

import { e2eeApi } from "../../api/client";
import { initiateSession, encryptForDevice } from "./session-manager";
import * as keyStorage from "./key-storage";
import type { Chat } from "../../api/client";

export interface EncryptedPayload {
  type: "chat.message";
  msg_type: string;
  content: string;
  is_encrypted: true;
  sender_device_id: number;
  encrypted_keys: Record<string, { type: 0 | 1; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number }>;
  reply_to?: string;
}

/** Build encrypted payload for a personal chat, or null if not applicable.
 * Encrypts for all recipient devices and sender's other devices (fan-out). */
export async function prepareEncryptedMessage(
  myUserId: string,
  chat: Chat | null,
  plaintext: string,
  replyToId?: string
): Promise<EncryptedPayload | null> {
  if (!chat?.is_personal || !chat.other_member?.id) return null;

  const myDeviceId = await keyStorage.getCurrentDeviceId();
  if (myDeviceId == null) return null;

  try {
    const { data } = await e2eeApi.getKeyBundle(chat.other_member.id);
    const devices = data.devices ?? [];
    if (devices.length === 0) return null;

  const encryptedKeys: EncryptedPayload["encrypted_keys"] = {};
  let content = "";

  for (const bundle of devices) {
    const hasSession = await keyStorage.getSession(chat.other_member.id, bundle.device_id);
    let entry: { type: 0 | 1; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number };

    if (!hasSession) {
      const prekey = await initiateSession(
        chat.other_member.id,
        bundle.device_id,
        bundle,
        plaintext
      );
      entry = {
        type: 0,
        body: prekey.body,
        identity_key: prekey.identity_key,
        ephemeral_key: prekey.ephemeral_key,
        spk_id: prekey.spk_id,
        opk_id: prekey.opk_id,
      };
      content = content || prekey.body;
    } else {
      const enc = await encryptForDevice(chat.other_member.id, bundle.device_id, bundle, plaintext);
      entry = { type: enc.type, body: enc.body };
      content = content || enc.body;
    }
    encryptedKeys[String(bundle.device_id)] = entry;
  }

    // Sender's other devices (for multidevice: decrypt on our other devices)
    if (myUserId !== chat.other_member.id) {
      try {
        const { data: myData } = await e2eeApi.getKeyBundle(myUserId);
        const myDevices = (myData.devices ?? []).filter((d) => d.device_id !== myDeviceId);
        for (const bundle of myDevices) {
          const hasSession = await keyStorage.getSession(myUserId, bundle.device_id);
          let entry: { type: 0 | 1; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number };

          if (!hasSession) {
            const prekey = await initiateSession(myUserId, bundle.device_id, bundle, plaintext);
            entry = {
              type: 0,
              body: prekey.body,
              identity_key: prekey.identity_key,
              ephemeral_key: prekey.ephemeral_key,
              spk_id: prekey.spk_id,
              opk_id: prekey.opk_id,
            };
            content = content || prekey.body;
          } else {
            const enc = await encryptForDevice(myUserId, bundle.device_id, bundle, plaintext);
            entry = { type: enc.type, body: enc.body };
            content = content || enc.body;
          }
          encryptedKeys[String(bundle.device_id)] = entry;
        }
      } catch {
        // Ignore if we can't fetch our own bundle (e.g. no other devices)
      }
    }

  return {
    type: "chat.message",
    msg_type: "text",
    content,
    is_encrypted: true,
    sender_device_id: myDeviceId,
    encrypted_keys: encryptedKeys,
    ...(replyToId ? { reply_to: replyToId } : {}),
  };
  } catch {
    return null;
  }
}
