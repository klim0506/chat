import { create } from "zustand";
import type { Chat, PaginatedResponse } from "../api/client";
import { chatsApi } from "../api/client";
import { db, type CachedChat } from "../lib/db";
import { useAuthStore } from "./auth";
import { useUnreadStore } from "./unread";

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

  /** Load chats: read IndexedDB cache first (instant), then revalidate from API. Resolves with true if network succeeded. */
  loadChats: () => Promise<boolean>;
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
  /** Force loading state (e.g. on timeout) */
  setLoading: (loading: boolean) => void;
  /** Increment unread count for a chat (or set to 0) */
  setUnread: (chatId: string, count: number | ((prev: number) => number)) => void;
  /** Reset everything (logout) */
  reset: () => void;
}

const MAX_PINNED = 5;
const CHAT_LIST_PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useChatListStore = create<ChatListState>()((set, get) => ({
  chats: [],
  loading: true,
  error: null,
  pinnedChatIds: [],

  loadChats: async (): Promise<boolean> => {
    // Only show loading spinner if we have no cached chats yet
    const hasChats = get().chats.length > 0;
    set({ loading: !hasChats, error: null });

    const currentUserId = useAuthStore.getState().user?.id;

    // 1. Instant render from IndexedDB cache (only if owned by current user)
    try {
      const cached = await db.chats.toArray();
      // Filter: only show chats that belong to current user.
      const legacyIds = cached.filter((c) => !c._userId).map((c) => c.id);
      if (legacyIds.length > 0) {
        db.chats.bulkDelete(legacyIds).catch(() => {});
      }
      const ownedChats = currentUserId
        ? cached.filter((c) => c._userId === currentUserId)
        : [];
      if (ownedChats.length > 0) {
        const chats = ownedChats
          .slice()
          .sort(sortCachedChats)
          .map(stripCacheMeta);
        const pins = extractPins(chats);
        set({ chats, pinnedChatIds: pins, loading: false });
      }
    } catch {
      // IndexedDB unavailable — proceed with network only
    }

    // 2. Revalidate from network (stale-while-revalidate)
    try {
      const existingById = new Map(get().chats.map((c) => [c.id, c]));
      let nextUrl: string | null = null;
      let page = 1;
      let fetchedOrder: Chat[] = [];
      do {
        const data: PaginatedResponse<Chat> = page === 1
          ? (await chatsApi.list({ limit: CHAT_LIST_PAGE_SIZE })).data
          : (await chatsApi.listByUrl(nextUrl!)).data;
        const pageRows: Chat[] = data.results ?? [];
        fetchedOrder = mergeOrderedUnique(fetchedOrder, pageRows);
        const mergedForUi = mergeForSmoothReorder(fetchedOrder, existingById);
        const pinsForUi = extractPins(mergedForUi);
        set({ chats: mergedForUi, pinnedChatIds: pinsForUi, loading: false, error: null });
        nextUrl = data.next ?? null;
        page += 1;
      } while (nextUrl);

      let freshChats: Chat[] = fetchedOrder;
      const hasFavorites = freshChats.some((c) => c.is_favorites);
      if (!hasFavorites) {
        try {
          const favRes = await chatsApi.getFavorites();
          const favChat = favRes.data;
          if (favChat) freshChats = [favChat, ...freshChats];
        } catch {
          // Игнорируем: без подписки или сеть — список без избранного
        }
      }
      const pins = extractPins(freshChats);
      set({ chats: freshChats, pinnedChatIds: pins, loading: false, error: null });
      const byChat: Record<string, number> = {};
      for (const c of freshChats) {
        if ((c.unread_count || 0) > 0) byChat[c.id] = c.unread_count!;
      }
      useUnreadStore.getState().setAll(byChat);

      // Persist to IndexedDB (fire-and-forget)
      persistChats(freshChats).catch(() => {});
      return true;
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // Only set error if we have no cached data
      if (get().chats.length === 0) {
        set({
          error: status === 403 ? "subscription_required" : "dashboard.loadError",
          loading: false,
        });
      } else {
        // We have cache — just stop loading
        set({ loading: false });
      }
      return false;
    }
  },

  upsertChat: (chat, updates) => {
    const merged = { ...chat, ...(updates || {}) };
    set((state) => {
      const idx = state.chats.findIndex((c) => c.id === chat.id);
      let next: Chat[];
      if (idx === -1) {
        next = [merged, ...state.chats];
      } else {
        next = [...state.chats];
        next[idx] = { ...next[idx], ...chat, ...(updates || {}) };
      }
      return { chats: next };
    });
    if ((merged.unread_count || 0) > 0) useUnreadStore.getState().setUnread(merged.id, merged.unread_count!);
    // Persist single chat update
    persistChat(merged as Chat).catch(() => {});
  },

  setChats: (chats) => {
    set({ chats });
    persistChats(chats).catch(() => {});
  },

  updateChat: (chatId, updates) => {
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chatId ? { ...c, ...updates } : c)),
    }));
    if (updates.unread_count !== undefined) {
      const n = updates.unread_count;
      if (n > 0) useUnreadStore.getState().setUnread(chatId, n);
      else useUnreadStore.getState().clearUnread(chatId);
    }
    // Persist the update
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat) persistChat({ ...chat, ...updates } as Chat).catch(() => {});
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
  setLoading: (loading) => set({ loading }),

  setUnread: (chatId, count) => {
    set((state) => {
      const nextChats = state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const newCount = typeof count === "function" ? count(c.unread_count || 0) : count;
        const finalCount = Math.max(0, newCount);
        return { ...c, unread_count: finalCount, ...(finalCount === 0 ? { manually_unread: false } : {}) };
      });
      const updated = nextChats.find((c) => c.id === chatId);
      const newCount = updated?.unread_count ?? 0;
      if (newCount > 0) useUnreadStore.getState().setUnread(chatId, newCount);
      else useUnreadStore.getState().clearUnread(chatId);
      return { chats: nextChats };
    });
  },

  reset: () => {
    set({ chats: [], loading: true, error: null, pinnedChatIds: [] });
    useUnreadStore.getState().reset();
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
  const { _cachedAt, _listPos, ...chat } = cached;
  return chat;
}

async function persistChats(chats: Chat[]) {
  const now = new Date().toISOString();
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const rows: CachedChat[] = chats.map((c, index) => ({
    ...c,
    _cachedAt: now,
    _userId: userId,
    _listPos: index,
  }));
  await db.chats.bulkPut(rows);
}

async function persistChat(chat: Chat) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const prev = await db.chats.get(chat.id).catch(() => undefined);
  const row: CachedChat = {
    ...chat,
    _cachedAt: new Date().toISOString(),
    _userId: userId,
    _listPos: prev?._listPos,
  };
  await db.chats.put(row);
}

function sortCachedChats(a: CachedChat, b: CachedChat): number {
  if (typeof a._listPos === "number" && typeof b._listPos === "number") {
    return a._listPos - b._listPos;
  }
  if (typeof a._listPos === "number") return -1;
  if (typeof b._listPos === "number") return 1;
  const aPin = a.pin_order ?? Number.MAX_SAFE_INTEGER;
  const bPin = b.pin_order ?? Number.MAX_SAFE_INTEGER;
  if (aPin !== bPin) return aPin - bPin;
  return toMs(b.last_message_at || b.created_at) - toMs(a.last_message_at || a.created_at);
}

function mergeOrderedUnique(base: Chat[], next: Chat[]): Chat[] {
  const seen = new Set<string>();
  const merged: Chat[] = [];
  for (const chat of [...base, ...next]) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    merged.push(chat);
  }
  return merged;
}

function mergeForSmoothReorder(fetchedOrder: Chat[], existingById: Map<string, Chat>): Chat[] {
  const mergedHead = fetchedOrder.map((chat) => ({ ...(existingById.get(chat.id) || {}), ...chat }));
  const fetchedIds = new Set(mergedHead.map((c) => c.id));
  const tail = [...existingById.values()].filter((c) => !fetchedIds.has(c.id));
  return [...mergedHead, ...tail];
}

function toMs(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

