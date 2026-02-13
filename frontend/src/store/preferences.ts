import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MESSAGE_TEXT_SCALES = [0.85, 0.9, 1, 1.1] as const;
export type MessageTextScale = (typeof MESSAGE_TEXT_SCALES)[number];
export type AppTheme = "light" | "dark";
export type AppLanguage = "en" | "ru";

function normalizeScale(value: unknown): MessageTextScale {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (typeof num === "number" && !Number.isNaN(num) && MESSAGE_TEXT_SCALES.includes(num as MessageTextScale)) {
    return num as MessageTextScale;
  }
  return 0.9;
}

interface PreferencesState {
  messageTextScale: MessageTextScale;
  theme: AppTheme;
  language: AppLanguage;
  setMessageTextScale: (scale: MessageTextScale) => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      messageTextScale: 0.9,
      theme: "light",
      language: "en",
      setMessageTextScale: (scale) => set({ messageTextScale: normalizeScale(scale) }),
      setTheme: (theme) => set({ theme: theme === "dark" ? "dark" : "light" }),
      setLanguage: (language) => set({ language: language === "ru" ? "ru" : "en" }),
    }),
    {
      name: "preferences",
      merge: (persisted, current) => {
        const stored = (persisted as {
          state?: { messageTextScale?: unknown; theme?: unknown; language?: unknown };
        } | null)?.state;
        const scale = stored?.messageTextScale ?? current.messageTextScale;
        const theme = stored?.theme === "dark" ? "dark" : "light";
        const language = stored?.language === "ru" ? "ru" : "en";
        return { ...current, messageTextScale: normalizeScale(scale), theme, language };
      },
    }
  )
);
