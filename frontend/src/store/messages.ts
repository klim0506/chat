import { create } from "zustand";
import type { Message } from "../api/client";
import { messagesApi } from "../api/client";
import { db, toCachedMessage, type CachedMessage } from "../lib/db";
import { useAuthStore } from "./auth";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MessagesState {
  /** Per-chat message arrays. Key = chatId. */
  byChat: Record<string, Message[]>;
  /** Whether a particular chat's messages are currently being loaded from the network. */
  loadingChats: Record<string, boolean>;
  /** Whether a chat has older messages available on the server (for pagination). */
  hasMoreByChat: Record<string, boolean>;
  /** Whether older messages are currently being fetched (to prevent duplicate requests). */
  loadingOlderChats: Record<string, boolean>;

  /* ---------- Actions ---------- */

  /** Load messages for a chat: IndexedDB first, then revalidate from API (latest page). */
  loadMessages: (chatId: string) => Promise<Message[]>;
  /** Load older messages for a chat (triggered by scrolling up). Returns the prepended messages. */
  loadOlderMessages: (chatId: string) => Promise<Message[]>;
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
  hasMoreByChat: {},
  loadingOlderChats: {},

  loadMessages: async (chatId) => {
    set((s) => ({ loadingChats: { ...s.loadingChats, [chatId]: true } }));

    const currentUserId = useAuthStore.getState().user?.id;

    // 1. Load from IndexedDB cache (instant, filtered by owner)
    try {
      const cached = await db.messages.where("chatId").equals(chatId).sortBy("created_at");
      const legacyIds = cached.filter((m) => !m._userId).map((m) => m.id);
      if (legacyIds.length > 0) {
        db.messages.bulkDelete(legacyIds).catch(() => {});
      }
      const owned = currentUserId
        ? cached.filter((m) => m._userId === currentUserId)
        : [];
      if (owned.length > 0) {
        const msgs = owned.map(stripCacheMeta);
        set((s) => ({
          byChat: { ...s.byChat, [chatId]: msgs },
          loadingChats: { ...s.loadingChats, [chatId]: false },
        }));
      }
    } catch {
      // IndexedDB unavailable
    }

    // 2. Revalidate from network (latest page)
    try {
      const res = await messagesApi.list(chatId);
      const rawFreshMsgs = res.data.map(normalizeMessage);

      // Preserve locally-decrypted content for encrypted messages that we already have
      // (WS handler decrypts in real-time and stores plaintext; API always returns ciphertext)
      const existingMsgs = get().byChat[chatId] ?? [];
      const existingMap = new Map(existingMsgs.map((m) => [m.id, m]));
      const freshMsgs = rawFreshMsgs.map((m) => {
        if (m.is_encrypted) {
          if (existingMap.has(m.id)) {
            const existing = existingMap.get(m.id)!;
            // Keep the cached content (decrypted plaintext or a user-friendly placeholder)
            return { ...m, content: existing.content };
          }
          // No cached version — show placeholder instead of raw ciphertext
          return { ...m, content: "Зашифрованное сообщение" };
        }
        return m;
      });

      set((s) => ({
        byChat: { ...s.byChat, [chatId]: freshMsgs },
        loadingChats: { ...s.loadingChats, [chatId]: false },
        hasMoreByChat: { ...s.hasMoreByChat, [chatId]: res.hasMore },
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

  loadOlderMessages: async (chatId) => {
    const state = get();
    // Guard: don't load if already loading or no more messages available
    if (state.loadingOlderChats[chatId]) return [];
    if (state.hasMoreByChat[chatId] === false) return [];

    const existing = state.byChat[chatId] ?? [];
    if (existing.length === 0) return [];

    // Cursor = created_at of the oldest message we currently have
    const oldestMsg = existing[0];
    const before = oldestMsg.created_at;

    set((s) => ({ loadingOlderChats: { ...s.loadingOlderChats, [chatId]: true } }));

    try {
      const res = await messagesApi.list(chatId, { before });
      const olderRaw = res.data.map(normalizeMessage);

      // Preserve decrypted content if we already have these messages cached
      const existingMap = new Map((get().byChat[chatId] ?? []).map((m) => [m.id, m]));
      const olderMsgs = olderRaw.map((m) => {
        if (m.is_encrypted) {
          if (existingMap.has(m.id)) {
            return { ...m, content: existingMap.get(m.id)!.content };
          }
          return { ...m, content: "Зашифрованное сообщение" };
        }
        return m;
      });

      // Deduplicate: filter out any messages that already exist
      const existingIds = new Set((get().byChat[chatId] ?? []).map((m) => m.id));
      const uniqueOlder = olderMsgs.filter((m) => !existingIds.has(m.id));

      set((s) => {
        const current = s.byChat[chatId] ?? [];
        return {
          byChat: { ...s.byChat, [chatId]: [...uniqueOlder, ...current] },
          hasMoreByChat: { ...s.hasMoreByChat, [chatId]: res.hasMore },
          loadingOlderChats: { ...s.loadingOlderChats, [chatId]: false },
        };
      });

      // Persist older messages to IndexedDB
      if (uniqueOlder.length > 0) {
        persistMessages(chatId, uniqueOlder).catch(() => {});
      }

      return uniqueOlder;
    } catch {
      set((s) => ({ loadingOlderChats: { ...s.loadingOlderChats, [chatId]: false } }));
      return [];
    }
  },

  upsertMessage: (chatId, msg) => {
    set((s) => {
      const prev = s.byChat[chatId] ?? [];
      return { byChat: { ...s.byChat, [chatId]: upsertSorted(prev, msg) } };
    });
    // Persist single message
    const userId = useAuthStore.getState().user?.id;
    if (userId) db.messages.put(toCachedMessage(msg, userId)).catch(() => {});
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
    if (updated) {
      const userId = useAuthStore.getState().user?.id;
      if (userId) db.messages.put(toCachedMessage(updated, userId)).catch(() => {});
    }
  },

  replaceTempMessage: (chatId, tempId, serverMsg) => {
    set((s) => {
      const prev = s.byChat[chatId] ?? [];
      const without = prev.filter((m) => m.id !== tempId);
      return { byChat: { ...s.byChat, [chatId]: upsertSorted(without, serverMsg) } };
    });
    // Remove temp from DB, add server message
    const userId = useAuthStore.getState().user?.id;
    db.messages.delete(tempId).catch(() => {});
    if (userId) db.messages.put(toCachedMessage(serverMsg, userId)).catch(() => {});
  },

  getMessages: (chatId) => get().byChat[chatId] ?? [],

  clearChat: (chatId) => {
    set((s) => {
      const nextByChat = { ...s.byChat };
      delete nextByChat[chatId];
      const nextHasMore = { ...s.hasMoreByChat };
      delete nextHasMore[chatId];
      const nextLoadingOlder = { ...s.loadingOlderChats };
      delete nextLoadingOlder[chatId];
      return { byChat: nextByChat, hasMoreByChat: nextHasMore, loadingOlderChats: nextLoadingOlder };
    });
    db.messages.where("chatId").equals(chatId).delete().catch(() => {});
    db.syncMeta.delete(chatId).catch(() => {});
  },

  reset: () => {
    set({ byChat: {}, loadingChats: {}, hasMoreByChat: {}, loadingOlderChats: {} });
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
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const rows = msgs.map((m) => toCachedMessage({ ...m, chat: chatId }, userId));
  await db.messages.bulkPut(rows);
}
