import { create } from "zustand";

interface UnreadState {
  /** Per-chat unread counts. Synced from chat list and WebSocket. */
  unreadByChat: Record<string, number>;
  setUnread: (chatId: string, count: number) => void;
  clearUnread: (chatId: string) => void;
  incrementUnread: (chatId: string) => void;
  /** Replace all counts (e.g. from chat list API) */
  setAll: (byChat: Record<string, number>) => void;
  reset: () => void;
}

export const useUnreadStore = create<UnreadState>()((set) => ({
  unreadByChat: {},

  setUnread: (chatId, count) =>
    set((state) => ({
      unreadByChat: {
        ...state.unreadByChat,
        [chatId]: Math.max(0, count),
      },
    })),

  clearUnread: (chatId) =>
    set((state) => {
      const next = { ...state.unreadByChat };
      delete next[chatId];
      return { unreadByChat: next };
    }),

  incrementUnread: (chatId) =>
    set((state) => ({
      unreadByChat: {
        ...state.unreadByChat,
        [chatId]: (state.unreadByChat[chatId] || 0) + 1,
      },
    })),

  setAll: (byChat) => set({ unreadByChat: { ...byChat } }),

  reset: () =>
    set((state) =>
      Object.keys(state.unreadByChat).length === 0
        ? state
        : { unreadByChat: {} },
    ),
}));

export function getTotalUnread(): number {
  return Object.values(useUnreadStore.getState().unreadByChat).reduce((a, b) => a + b, 0);
}
