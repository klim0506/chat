import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { db } from "../lib/db";

interface AuthUser {
  id: string;
  phone: string;
  display_name: string;
  username?: string | null;
  telegram_username?: string;
  avatar?: string | null;
  avatar_url?: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** Current session ID (from JWT "sid" claim) — used for session management. */
  sessionId: string | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string, user?: AuthUser) => void;
  clearTokens: () => void;
}

/** Decode JWT payload without verification (to extract user_id, sid). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      sessionId: null,
      isAuthenticated: false,
      setTokens: (access, refresh, user) => {
        const payload = decodeJwtPayload(access);
        const userId = payload?.user_id as string | undefined;
        const sessionId = (payload?.sid as string) || null;
        // Preserve existing user data (including avatar) when no user param provided (e.g. token refresh)
        const existing = useAuthStore.getState().user;
        const resolved: AuthUser | null = user ?? existing ?? (userId ? { id: userId, phone: "", display_name: "" } : null);
        set({ accessToken: access, refreshToken: refresh, user: resolved, sessionId, isAuthenticated: true });
      },
      clearTokens: () => {
        // Clear all user-specific cached data to prevent cross-account leaks
        // Use lazy imports to avoid circular dependency with other stores
        import("./chatList").then(({ useChatListStore }) => useChatListStore.getState().reset()).catch(() => {});
        import("./messages").then(({ useMessagesStore }) => useMessagesStore.getState().reset()).catch(() => {});
        import("./outbox").then(({ useOutboxStore }) => useOutboxStore.getState().reset()).catch(() => {});
        // Also clear IndexedDB directly as a safety net (all user-specific tables)
        db.chats.clear().catch(() => {});
        db.messages.clear().catch(() => {});
        db.syncMeta.clear().catch(() => {});
        db.outbox.clear().catch(() => {});
        db.identityKeyPair.clear().catch(() => {});
        db.signedPreKeys.clear().catch(() => {});
        db.preKeys.clear().catch(() => {});
        db.sessions.clear().catch(() => {});
        db.trustedIdentities.clear().catch(() => {});
        // Clear auth state
        set({ accessToken: null, refreshToken: null, user: null, sessionId: null, isAuthenticated: false });
      },
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
