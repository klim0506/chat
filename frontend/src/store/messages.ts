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
  /** Remove a message by id (e.g. temp upload message on error). */
  removeMessage: (chatId: string, messageId: string) => void;
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

/** Initial load: 10 messages at once (no "2 first, then rest"). Scroll up: load 50 per batch. */
const INITIAL_MESSAGES_LIMIT = 10;
const OLDER_PAGE_SIZE = 50;
/** Max messages to read from cache on open (slightly more than initial API page). */
const CACHE_READ_LIMIT = 20;

/** Read last N messages for a chat from IndexedDB (owned by current user). Returns Message[] for API compatibility. */
async function getCachedMessages(chatId: string, limit: number): Promise<Message[]> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return [];
  try {
    // Compound index [chatId+created_at]: query chat, newest first, then take last `limit` and reverse to chronological
    const cached = await db.messages
      .where("[chatId+created_at]")
      .between([chatId, ""], [chatId, "\uffff"])
      .reverse()
      .limit(limit)
      .toArray();
    const owned = cached.filter((c) => c._userId === userId) as CachedMessage[];
    const chronological = owned.reverse();
    return chronological.map(({ chatId: _cid, _userId: _u, ...msg }) => ({ ...msg, chat: chatId }));
  } catch {
    return [];
  }
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

    // 1. Cache-first: show cached messages immediately so UI doesn't block
    const cached = await getCachedMessages(chatId, CACHE_READ_LIMIT);
    if (cached.length > 0) {
      set((s) => ({
        byChat: { ...s.byChat, [chatId]: cached },
        loadingChats: { ...s.loadingChats, [chatId]: false },
      }));
    }

    // 2. Revalidate from API (stale-while-revalidate)
    try {
      const res = await messagesApi.list(chatId, { limit: INITIAL_MESSAGES_LIMIT });
      const raw = res.data.map(normalizeMessage);
      const msgs = raw.map((m) => {
        if (m.is_encrypted) return { ...m, content: "Зашифрованное сообщение" };
        return m;
      });
      const sorted = [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      set((s) => ({
        byChat: { ...s.byChat, [chatId]: sorted },
        loadingChats: { ...s.loadingChats, [chatId]: false },
        hasMoreByChat: { ...s.hasMoreByChat, [chatId]: res.hasMore },
      }));

      persistMessages(chatId, sorted).catch(() => {});
      if (sorted.length > 0) {
        const newest = sorted[sorted.length - 1];
        db.syncMeta.put({
          chatId,
          lastMessageAt: newest.created_at,
          lastFullSyncAt: new Date().toISOString(),
        }).catch(() => {});
      }
      return sorted;
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
      const res = await messagesApi.list(chatId, { before, limit: OLDER_PAGE_SIZE });
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
        const merged = [...uniqueOlder, ...current];
        const sorted = merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return {
          byChat: { ...s.byChat, [chatId]: sorted },
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
      const prevArr = s.byChat[chatId] ?? [];
      return { byChat: { ...s.byChat, [chatId]: upsertSorted(prevArr, msg) } };
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

  removeMessage: (chatId, messageId) => {
    set((s) => {
      const prev = s.byChat[chatId];
      if (!prev) return s;
      const next = prev.filter((m) => m.id !== messageId);
      return { byChat: { ...s.byChat, [chatId]: next } };
    });
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

async function persistMessages(chatId: string, msgs: Message[]) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const rows = msgs.map((m) => toCachedMessage({ ...m, chat: chatId }, userId));
  await db.messages.bulkPut(rows);
}
