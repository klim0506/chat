import { create } from "zustand";
import type { Message } from "../api/client";
import { messagesApi } from "../api/client";
import { db, toCachedMessage, type CachedMessage } from "../lib/db";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MessagesState {
  /** Per-chat message arrays. Key = chatId. */
  byChat: Record<string, Message[]>;
  /** Whether a particular chat's messages are currently being loaded from the network. */
  loadingChats: Record<string, boolean>;

  /* ---------- Actions ---------- */

  /** Load messages for a chat: IndexedDB first, then revalidate from API. */
  loadMessages: (chatId: string) => Promise<Message[]>;
  /** Add or update a single message (from WS, REST, or outbox confirmation). */
  upsertMessage: (chatId: string, msg: Message) => void;
  /** Update a message by id within a chat (edit, reaction, delete). */
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  /** Replace an outbox temp message with the real server message. */
  replaceTempMessage: (chatId: string, tempId: string, serverMsg: Message) => void;
  /** Get the messages array for a specific chat (empty if not loaded). */
  getMessages: (chatId: string) => Message[];
  /** Clear messages for a specific chat (e.g. on leave). */
  clearChat: (chatId: string) => void;
  /** Reset all messages (logout). */
  reset: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Normalize a message from API/WS to a consistent shape. */
export function normalizeMessage(msg: Message & { my_reaction?: string | null; read_by?: unknown[] }): Message {
  let files = msg.files ?? [];
  if (!Array.isArray(files)) files = [];
  if (files.length === 0 && msg.file) files = [msg.file];
  const safeFiles = files.filter((f) => f != null && typeof f === "object" && "id" in f) as Message["files"];
  const file = msg.file != null && typeof msg.file === "object" && "id" in msg.file ? msg.file : (safeFiles[0] ?? null);
  const myReactions = msg.my_reactions ?? (msg.my_reaction ? [msg.my_reaction] : []);
  const readBy = msg.read_by;
  return {
    ...msg,
    file: file as Message["file"],
    files: safeFiles as Message["files"],
    reactions: msg.reactions ?? {},
    my_reactions: Array.isArray(myReactions) ? myReactions : [],
    read_status: msg.read_status ?? undefined,
    read_by: Array.isArray(readBy) ? (readBy as Message["read_by"]) : undefined,
  };
}

/** Insert or replace a message in a sorted (by created_at) array. */
function upsertSorted(prev: Message[], next: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === next.id);
  if (idx >= 0) {
    const copy = prev.slice();
    copy[idx] = next;
    return copy;
  }
  const ts = new Date(next.created_at).getTime();
  let insertAt = prev.length;
  for (let i = 0; i < prev.length; i++) {
    if (new Date(prev[i].created_at).getTime() > ts) {
      insertAt = i;
      break;
    }
  }
  const copy = prev.slice();
  copy.splice(insertAt, 0, next);
  return copy;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  byChat: {},
  loadingChats: {},

  loadMessages: async (chatId) => {
    set((s) => ({ loadingChats: { ...s.loadingChats, [chatId]: true } }));

    // 1. Load from IndexedDB cache (instant)
    try {
      const cached = await db.messages.where("chatId").equals(chatId).sortBy("created_at");
      if (cached.length > 0) {
        const msgs = cached.map(stripCacheMeta);
        set((s) => ({
          byChat: { ...s.byChat, [chatId]: msgs },
          loadingChats: { ...s.loadingChats, [chatId]: false },
        }));
      }
    } catch {
      // IndexedDB unavailable
    }

    // 2. Revalidate from network
    try {
      const res = await messagesApi.list(chatId);
      const freshMsgs = (res.data as Message[]).map(normalizeMessage);
      set((s) => ({
        byChat: { ...s.byChat, [chatId]: freshMsgs },
        loadingChats: { ...s.loadingChats, [chatId]: false },
      }));

      // Persist to IndexedDB
      persistMessages(chatId, freshMsgs).catch(() => {});

      // Update sync meta
      if (freshMsgs.length > 0) {
        const newest = freshMsgs[freshMsgs.length - 1];
        db.syncMeta.put({
          chatId,
          lastMessageAt: newest.created_at,
          lastFullSyncAt: new Date().toISOString(),
        }).catch(() => {});
      }

      return freshMsgs;
    } catch {
      set((s) => ({ loadingChats: { ...s.loadingChats, [chatId]: false } }));
      return get().byChat[chatId] ?? [];
    }
  },

  upsertMessage: (chatId, msg) => {
    set((s) => {
      const prev = s.byChat[chatId] ?? [];
      return { byChat: { ...s.byChat, [chatId]: upsertSorted(prev, msg) } };
    });
    // Persist single message
    db.messages.put(toCachedMessage(msg)).catch(() => {});
  },

  updateMessage: (chatId, messageId, updates) => {
    set((s) => {
      const prev = s.byChat[chatId];
      if (!prev) return s;
      const next = prev.map((m) => (m.id === messageId ? { ...m, ...updates } : m));
      return { byChat: { ...s.byChat, [chatId]: next } };
    });
    // Persist the updated message
    const msgs = get().byChat[chatId];
    const updated = msgs?.find((m) => m.id === messageId);
    if (updated) db.messages.put(toCachedMessage(updated)).catch(() => {});
  },

  replaceTempMessage: (chatId, tempId, serverMsg) => {
    set((s) => {
      const prev = s.byChat[chatId] ?? [];
      const without = prev.filter((m) => m.id !== tempId);
      return { byChat: { ...s.byChat, [chatId]: upsertSorted(without, serverMsg) } };
    });
    // Remove temp from DB, add server message
    db.messages.delete(tempId).catch(() => {});
    db.messages.put(toCachedMessage(serverMsg)).catch(() => {});
  },

  getMessages: (chatId) => get().byChat[chatId] ?? [],

  clearChat: (chatId) => {
    set((s) => {
      const next = { ...s.byChat };
      delete next[chatId];
      return { byChat: next };
    });
    db.messages.where("chatId").equals(chatId).delete().catch(() => {});
    db.syncMeta.delete(chatId).catch(() => {});
  },

  reset: () => {
    set({ byChat: {}, loadingChats: {} });
    db.messages.clear().catch(() => {});
    db.syncMeta.clear().catch(() => {});
  },
}));

/* ------------------------------------------------------------------ */
/*  Persistence helpers                                                */
/* ------------------------------------------------------------------ */

function stripCacheMeta(cached: CachedMessage): Message {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { chatId: _chatId, ...msg } = cached;
  return msg;
}

async function persistMessages(chatId: string, msgs: Message[]) {
  const rows = msgs.map((m) => toCachedMessage({ ...m, chat: chatId }));
  await db.messages.bulkPut(rows);
}
