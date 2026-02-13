import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AuthUser {
  id: string;
  phone: string;
  display_name: string;
  username?: string | null;
  telegram_username?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string, user?: AuthUser) => void;
  clearTokens: () => void;
}

/** Decode JWT payload without verification (to extract user_id). */
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
      isAuthenticated: false,
      setTokens: (access, refresh, user) => {
        const payload = decodeJwtPayload(access);
        const userId = payload?.user_id as string | undefined;
        const resolved: AuthUser | null = user ?? (userId ? { id: userId, phone: "", display_name: "" } : null);
        set({ accessToken: access, refreshToken: refresh, user: resolved, isAuthenticated: true });
      },
      clearTokens: () => set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
