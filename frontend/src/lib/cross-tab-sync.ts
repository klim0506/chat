/**
 * Cross-tab message sync via BroadcastChannel.
 * When a message is created via REST on one tab, we broadcast it so other tabs
 * (same browser) can upsert it immediately without waiting for WebSocket.
 * Works on desktop and mobile browsers that support BroadcastChannel.
 */

import type { Message } from "../api/client";
import { useMessagesStore } from "../store/messages";
import { normalizeMessage } from "../store/messages";

const CHANNEL_NAME = "chat-message-sync";

export type CrossTabMessagePayload = {
  type: "message_created";
  chatId: string;
  message: Message;
};

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** Broadcast a newly created message so other tabs can upsert it. Call after REST create. */
export function broadcastMessageCreated(chatId: string, message: Message): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    const payload: CrossTabMessagePayload = { type: "message_created", chatId, message };
    ch.postMessage(payload);
  } catch {
    // ignore
  } finally {
    ch.close();
  }
}

/** Subscribe to cross-tab message sync. Call once when the app mounts (e.g. in MessengerPage). */
export function subscribeCrossTabMessageSync(): () => void {
  const ch = getChannel();
  if (!ch) return () => {};

  const handler = (event: MessageEvent<CrossTabMessagePayload>) => {
    const data = event.data;
    if (!data || data.type !== "message_created" || !data.chatId || !data.message) return;
    const msg = normalizeMessage(data.message as Parameters<typeof normalizeMessage>[0]);
    useMessagesStore.getState().upsertMessage(data.chatId, msg);
  };

  ch.addEventListener("message", handler);
  return () => {
    ch.removeEventListener("message", handler);
    ch.close();
  };
}
