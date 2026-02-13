import { create } from "zustand";
import type { Chat } from "../api/client";
import { chatsApi } from "../api/client";
import { db, type CachedChat } from "../lib/db";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatListState {
  /** All chats available to the current user */
  chats: Chat[];
  /** Whether the initial load (cache or network) is still pending */
  loading: boolean;
  /** Last load error (if any) */
  error: string | null;
  /** Ordered list of pinned chat IDs */
  pinnedChatIds: string[];

  /* ---------- Actions ---------- */

  /** Load chats: read IndexedDB cache first (instant), then revalidate from API */
  loadChats: () => Promise<void>;
  /** Upsert a single chat (from WS event, API response, etc.) */
  upsertChat: (chat: Chat, updates?: Partial<Chat>) => void;
  /** Replace the full chat list (e.g. after API fetch) */
  setChats: (chats: Chat[]) => void;
  /** Update a chat by id with partial data */
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  /** Remove a chat from the list (leave / delete) */
  removeChat: (chatId: string) => void;
  /** Set pinned chat IDs */
  setPinnedChatIds: (ids: string[]) => void;
  /** Increment unread count for a chat (or set to 0) */
  setUnread: (chatId: string, count: number | ((prev: number) => number)) => void;
  /** Reset everything (logout) */
  reset: () => void;
}

const MAX_PINNED = 5;

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useChatListStore = create<ChatListState>()((set, get) => ({
  chats: [],
  loading: true,
  error: null,
  pinnedChatIds: [],

  loadChats: async () => {
    set({ loading: true, error: null });

    // 1. Instant render from IndexedDB cache
    try {
      const cached = await db.chats.toArray();
      if (cached.length > 0) {
        const chats = cached.map(stripCacheMeta);
        const pins = extractPins(chats);
        set({ chats, pinnedChatIds: pins, loading: false });
      }
    } catch {
      // IndexedDB unavailable — proceed with network only
    }

    // 2. Revalidate from network (stale-while-revalidate)
    try {
      const res = await chatsApi.list();
      const data = res.data;
      const freshChats: Chat[] = Array.isArray(data) ? data : data.results ?? [];
      const pins = extractPins(freshChats);
      set({ chats: freshChats, pinnedChatIds: pins, loading: false, error: null });

      // Persist to IndexedDB (fire-and-forget)
      persistChats(freshChats).catch(() => {});
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // Only set error if we have no cached data
      if (get().chats.length === 0) {
        set({
          error: status === 403 ? "subscription_required" : "Не удалось загрузить чаты",
          loading: false,
        });
      } else {
        // We have cache — just stop loading
        set({ loading: false });
      }
    }
  },

  upsertChat: (chat, updates) => {
    set((state) => {
      const idx = state.chats.findIndex((c) => c.id === chat.id);
      let next: Chat[];
      if (idx === -1) {
        next = [{ ...chat, ...(updates || {}) }, ...state.chats];
      } else {
        next = [...state.chats];
        next[idx] = { ...next[idx], ...chat, ...(updates || {}) };
      }
      return { chats: next };
    });
    // Persist single chat update
    persistChat({ ...chat, ...(updates || {}) } as Chat).catch(() => {});
  },

  setChats: (chats) => {
    set({ chats });
    persistChats(chats).catch(() => {});
  },

  updateChat: (chatId, updates) => {
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chatId ? { ...c, ...updates } : c)),
    }));
    // Persist the update
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat) persistChat(chat).catch(() => {});
  },

  removeChat: (chatId) => {
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== chatId),
      pinnedChatIds: state.pinnedChatIds.filter((id) => id !== chatId),
    }));
    db.chats.delete(chatId).catch(() => {});
  },

  setPinnedChatIds: (ids) => {
    set({ pinnedChatIds: ids.slice(0, MAX_PINNED) });
  },

  setUnread: (chatId, count) => {
    set((state) => ({
      chats: state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const newCount = typeof count === "function" ? count(c.unread_count || 0) : count;
        return { ...c, unread_count: Math.max(0, newCount) };
      }),
    }));
  },

  reset: () => {
    set({ chats: [], loading: true, error: null, pinnedChatIds: [] });
    db.chats.clear().catch(() => {});
    db.syncMeta.clear().catch(() => {});
  },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractPins(chats: Chat[]): string[] {
  return chats
    .filter((c) => c.pin_order != null)
    .sort((a, b) => (a.pin_order || 0) - (b.pin_order || 0))
    .map((c) => c.id)
    .slice(0, MAX_PINNED);
}

function stripCacheMeta(cached: CachedChat): Chat {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _cachedAt, ...chat } = cached;
  return chat;
}

async function persistChats(chats: Chat[]) {
  const now = new Date().toISOString();
  const rows: CachedChat[] = chats.map((c) => ({ ...c, _cachedAt: now }));
  await db.chats.bulkPut(rows);
}

async function persistChat(chat: Chat) {
  const row: CachedChat = { ...chat, _cachedAt: new Date().toISOString() };
  await db.chats.put(row);
}
