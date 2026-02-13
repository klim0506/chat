import { create } from "zustand";
import { db, clientId, type OutboxItem } from "../lib/db";
import { messagesApi, filesApi } from "../api/client";
import type { Message } from "../api/client";
import { useMessagesStore, normalizeMessage } from "./messages";
import { useNetworkStore } from "./network";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OutboxState {
  /** All pending outbox items across all chats */
  items: OutboxItem[];
  /** Whether a flush is currently running */
  flushing: boolean;

  /* ---------- Actions ---------- */

  /** Load outbox items from IndexedDB (call once on app start / reconnect). */
  load: () => Promise<void>;
  /** Enqueue a new message for send. Returns the temporary client-side ID. */
  enqueue: (params: {
    chatId: string;
    msgType: string;
    content: string;
    fileIds?: string[];
    fileBlobs?: Blob[];
    fileNames?: string[];
    waveform?: number[];
  }) => string;
  /** Send all pending items. Called on reconnect or when coming back online. */
  flush: () => Promise<void>;
  /** Remove an item by id (after successful send). */
  remove: (id: string) => void;
  /** Mark an item as failed with an error message. */
  markFailed: (id: string, error: string) => void;
  /** Retry a specific failed item. */
  retry: (id: string) => Promise<void>;
  /** Get outbox items for a specific chat. */
  forChat: (chatId: string) => OutboxItem[];
  /** Reset (logout). */
  reset: () => void;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000]; // exponential backoff

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useOutboxStore = create<OutboxState>()((set, get) => ({
  items: [],
  flushing: false,

  load: async () => {
    try {
      const items = await db.outbox.toArray();
      set({ items });
    } catch {
      // IndexedDB unavailable
    }
  },

  enqueue: (params) => {
    const id = clientId();
    const item: OutboxItem = {
      id,
      chatId: params.chatId,
      msgType: params.msgType,
      content: params.content,
      fileIds: params.fileIds,
      fileBlobs: params.fileBlobs,
      fileNames: params.fileNames,
      waveform: params.waveform,
      createdAt: Date.now(),
      status: "pending",
      retries: 0,
    };

    set((s) => ({ items: [...s.items, item] }));
    db.outbox.put(item).catch(() => {});

    // Also show optimistic message in the messages store
    const optimisticMsg: Message = {
      id,
      chat: params.chatId,
      sender: { id: "self", phone: "", display_name: "", avatar: null },
      msg_type: params.msgType,
      content: params.content,
      file: null,
      files: [],
      created_at: new Date().toISOString(),
      edited_at: null,
      is_deleted: false,
      reactions: {},
      my_reactions: [],
      read_status: undefined,
    };
    useMessagesStore.getState().upsertMessage(params.chatId, optimisticMsg);

    // If online, try to send immediately
    if (useNetworkStore.getState().isOnline) {
      sendItem(item).catch(() => {});
    }

    return id;
  },

  flush: async () => {
    if (get().flushing) return;
    set({ flushing: true });

    const pending = get().items.filter((i) => i.status === "pending" || i.status === "failed");
    for (const item of pending) {
      if (!useNetworkStore.getState().isOnline) break;
      await sendItem(item);
    }

    set({ flushing: false });
  },

  remove: (id) => {
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
    db.outbox.delete(id).catch(() => {});
  },

  markFailed: (id, error) => {
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, status: "failed" as const, lastError: error } : i
      ),
    }));
    db.outbox.update(id, { status: "failed", lastError: error }).catch(() => {});
  },

  retry: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    // Reset status to pending
    const updated = { ...item, status: "pending" as const, retries: 0 };
    set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }));
    db.outbox.put(updated).catch(() => {});
    await sendItem(updated);
  },

  forChat: (chatId) => get().items.filter((i) => i.chatId === chatId),

  reset: () => {
    set({ items: [], flushing: false });
    db.outbox.clear().catch(() => {});
  },
}));

/* ------------------------------------------------------------------ */
/*  Send logic                                                         */
/* ------------------------------------------------------------------ */

async function sendItem(item: OutboxItem): Promise<void> {
  const store = useOutboxStore.getState();
  const messagesStore = useMessagesStore.getState();

  // Mark as sending
  useOutboxStore.setState((s) => ({
    items: s.items.map((i) =>
      i.id === item.id ? { ...i, status: "sending" as const } : i
    ),
  }));
  db.outbox.update(item.id, { status: "sending" }).catch(() => {});

  try {
    let fileIds = item.fileIds ?? [];

    // Upload any pending file blobs first
    if (item.fileBlobs && item.fileBlobs.length > 0) {
      const uploadedIds: string[] = [];
      for (let i = 0; i < item.fileBlobs.length; i++) {
        const blob = item.fileBlobs[i];
        const name = item.fileNames?.[i] ?? `file_${i}`;
        const file = new File([blob], name, { type: blob.type });
        const res = await filesApi.upload(file, item.chatId);
        uploadedIds.push(res.data.id);
      }
      fileIds = uploadedIds;
    }

    // Create the message on the server
    const payload: Record<string, unknown> = {
      msg_type: item.msgType,
      content: item.content,
    };
    if (fileIds.length === 1) payload.file_id = fileIds[0];
    else if (fileIds.length > 1) payload.file_ids = fileIds;
    if (item.waveform) payload.waveform = item.waveform;

    const res = await messagesApi.create(item.chatId, payload as Parameters<typeof messagesApi.create>[1]);
    const serverMsg = normalizeMessage(res.data);

    // Replace optimistic message with server message
    messagesStore.replaceTempMessage(item.chatId, item.id, serverMsg);

    // Remove from outbox
    store.remove(item.id);
  } catch (err) {
    const retries = item.retries + 1;
    const status = (err as { response?: { status?: number } })?.response?.status;
    const is4xx = status !== undefined && status >= 400 && status < 500;

    if (is4xx || retries > MAX_RETRIES) {
      // Permanent failure — mark as failed
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Ошибка отправки";
      store.markFailed(item.id, errorMsg);
    } else {
      // Transient failure — schedule retry with backoff
      const delay = RETRY_DELAYS[Math.min(retries - 1, RETRY_DELAYS.length - 1)];
      const updated = { ...item, status: "pending" as const, retries };
      useOutboxStore.setState((s) => ({
        items: s.items.map((i) => (i.id === item.id ? updated : i)),
      }));
      db.outbox.put(updated).catch(() => {});

      setTimeout(() => {
        if (useNetworkStore.getState().isOnline) {
          sendItem(updated).catch(() => {});
        }
      }, delay);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Auto-flush on coming back online                                   */
/* ------------------------------------------------------------------ */

if (typeof window !== "undefined") {
  // When network comes back online, flush the outbox
  useNetworkStore.subscribe((state) => {
    if (state.isOnline) {
      useOutboxStore.getState().flush().catch(() => {});
    }
  });
}
