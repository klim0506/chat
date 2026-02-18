import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MESSAGE_TEXT_SCALES = [0.75, 0.85, 1, 1.15, 1.3] as const;
export type MessageTextScale = (typeof MESSAGE_TEXT_SCALES)[number];
export type AppTheme = "light" | "dark";
export type AppLanguage = "en" | "ru";

function normalizeScale(value: unknown): MessageTextScale {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (typeof num === "number" && !Number.isNaN(num) && MESSAGE_TEXT_SCALES.includes(num as MessageTextScale)) {
    return num as MessageTextScale;
  }
  return 1;
}

interface PreferencesState {
  messageTextScale: MessageTextScale;
  theme: AppTheme;
  language: AppLanguage;
  soundEnabled: boolean;
  soundSend: boolean;
  soundReceive: boolean;
  soundMention: boolean;
  setMessageTextScale: (scale: MessageTextScale) => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundSend: (enabled: boolean) => void;
  setSoundReceive: (enabled: boolean) => void;
  setSoundMention: (enabled: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      messageTextScale: 1,
      theme: "light",
      language: "en",
      soundEnabled: true,
      soundSend: true,
      soundReceive: true,
      soundMention: true,
      setMessageTextScale: (scale) => set({ messageTextScale: normalizeScale(scale) }),
      setTheme: (theme) => set({ theme: theme === "dark" ? "dark" : "light" }),
      setLanguage: (language) => set({ language: language === "ru" ? "ru" : "en" }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setSoundSend: (enabled) => set({ soundSend: enabled }),
      setSoundReceive: (enabled) => set({ soundReceive: enabled }),
      setSoundMention: (enabled) => set({ soundMention: enabled }),
    }),
    {
      name: "preferences",
      merge: (persisted, current) => {
        const stored = (persisted as {
          state?: {
            messageTextScale?: unknown;
            theme?: unknown;
            language?: unknown;
            soundEnabled?: boolean;
            soundSend?: boolean;
            soundReceive?: boolean;
            soundMention?: boolean;
          };
        } | null)?.state;
        const scale = stored?.messageTextScale ?? current.messageTextScale;
        const theme = stored?.theme === "dark" ? "dark" : "light";
        const language = stored?.language === "ru" ? "ru" : "en";
        const soundEnabled = stored?.soundEnabled ?? current.soundEnabled;
        const soundSend = stored?.soundSend ?? current.soundSend;
        const soundReceive = stored?.soundReceive ?? current.soundReceive;
        const soundMention = stored?.soundMention ?? current.soundMention;
        return {
          ...current,
          messageTextScale: normalizeScale(scale),
          theme,
          language,
          soundEnabled,
          soundSend,
          soundReceive,
          soundMention,
        };
      },
    }
  )
);
