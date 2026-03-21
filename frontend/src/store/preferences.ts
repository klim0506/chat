import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MESSAGE_TEXT_SCALE_MIN = 0.75;
export const MESSAGE_TEXT_SCALE_MAX = 1.3;
export const MESSAGE_TEXT_SCALES = [0.75, 0.85, 1, 1.15, 1.3] as const;
export const DEFAULT_MESSAGE_TEXT_SCALE = 1;
export type MessageTextScale = number;
export type AppTheme = "light" | "dark";
export type AppLanguage = "en" | "ru";
export type FolderLayout = "left" | "top";
export type MessageAlignment = "left" | "right";

/** Язык по умолчанию везде — русский. */
const DEFAULT_LANGUAGE: AppLanguage = "ru";

export function normalizeMessageTextScale(value: unknown): MessageTextScale {
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  if (typeof num === "number" && !Number.isNaN(num)) {
    return Math.max(MESSAGE_TEXT_SCALE_MIN, Math.min(MESSAGE_TEXT_SCALE_MAX, Math.round(num * 100) / 100));
  }
  return DEFAULT_MESSAGE_TEXT_SCALE;
}

interface PreferencesState {
  messageTextScale: MessageTextScale;
  theme: AppTheme;
  language: AppLanguage;
  soundEnabled: boolean;
  soundSend: boolean;
  soundReceive: boolean;
  soundMention: boolean;
  folderLayout: FolderLayout;
  foldersEnabled: boolean;
  showFolderPersonal: boolean;
  showFolderUnread: boolean;
  showFolderArchive: boolean;
  folderColorPersonal: string;
  folderColorUnread: string;
  folderColorArchive: string;
  messageAlignment: MessageAlignment;
  setMessageTextScale: (scale: MessageTextScale) => void;
  setMessageAlignment: (alignment: MessageAlignment) => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundSend: (enabled: boolean) => void;
  setSoundReceive: (enabled: boolean) => void;
  setSoundMention: (enabled: boolean) => void;
  setFolderLayout: (layout: FolderLayout) => void;
  setFoldersEnabled: (enabled: boolean) => void;
  setShowFolderPersonal: (enabled: boolean) => void;
  setShowFolderUnread: (enabled: boolean) => void;
  setShowFolderArchive: (enabled: boolean) => void;
  setFolderColorPersonal: (color: string) => void;
  setFolderColorUnread: (color: string) => void;
  setFolderColorArchive: (color: string) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      messageTextScale: DEFAULT_MESSAGE_TEXT_SCALE,
      theme: "light",
      language: DEFAULT_LANGUAGE,
      soundEnabled: true,
      soundSend: true,
      soundReceive: true,
      soundMention: true,
      folderLayout: "left",
      foldersEnabled: false,
      showFolderPersonal: true,
      showFolderUnread: true,
      showFolderArchive: true,
      folderColorPersonal: "#3B82F6",
      folderColorUnread: "#F59E0B",
      folderColorArchive: "#6B7280",
      messageAlignment: "right",
      setMessageTextScale: (scale) => set({ messageTextScale: normalizeMessageTextScale(scale) as MessageTextScale }),
      setMessageAlignment: (alignment) => set({ messageAlignment: alignment === "right" ? "right" : "left" }),
      setTheme: (theme) => set({ theme: theme === "dark" ? "dark" : "light" }),
      setLanguage: (language) => set({ language: language === "ru" ? "ru" : "en" }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setSoundSend: (enabled) => set({ soundSend: enabled }),
      setSoundReceive: (enabled) => set({ soundReceive: enabled }),
      setSoundMention: (enabled) => set({ soundMention: enabled }),
      setFolderLayout: (layout) => set({ folderLayout: layout === "top" ? "top" : "left" }),
      setFoldersEnabled: (enabled) => set({ foldersEnabled: enabled }),
      setShowFolderPersonal: (enabled) => set({ showFolderPersonal: enabled }),
      setShowFolderUnread: (enabled) => set({ showFolderUnread: enabled }),
      setShowFolderArchive: (enabled) => set({ showFolderArchive: enabled }),
      setFolderColorPersonal: (color) => set({ folderColorPersonal: color || "#3B82F6" }),
      setFolderColorUnread: (color) => set({ folderColorUnread: color || "#F59E0B" }),
      setFolderColorArchive: (color) => set({ folderColorArchive: color || "#6B7280" }),
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
            folderLayout?: "left" | "top";
            foldersEnabled?: boolean;
            showFolderPersonal?: boolean;
            showFolderUnread?: boolean;
            showFolderArchive?: boolean;
            folderColorPersonal?: string;
            folderColorUnread?: string;
            folderColorArchive?: string;
            messageAlignment?: "left" | "right";
          };
        } | null)?.state;
        const scale = stored?.messageTextScale ?? current.messageTextScale;
        const theme = stored?.theme === "dark" ? "dark" : "light";
        const language =
          stored?.language === "ru" ? "ru" : stored?.language === "en" ? "en" : DEFAULT_LANGUAGE;
        const soundEnabled = stored?.soundEnabled ?? current.soundEnabled;
        const soundSend = stored?.soundSend ?? current.soundSend;
        const soundReceive = stored?.soundReceive ?? current.soundReceive;
        const soundMention = stored?.soundMention ?? current.soundMention;
        const folderLayout = stored?.folderLayout === "top" ? "top" : "left";
        const foldersEnabled = stored?.foldersEnabled ?? stored?.showFolderPersonal ?? stored?.showFolderUnread ?? stored?.showFolderArchive ?? current.foldersEnabled;
        const showFolderPersonal = stored?.showFolderPersonal ?? foldersEnabled;
        const showFolderUnread = stored?.showFolderUnread ?? foldersEnabled;
        const showFolderArchive = stored?.showFolderArchive ?? foldersEnabled;
        const folderColorPersonal = stored?.folderColorPersonal ?? current.folderColorPersonal;
        const folderColorUnread = stored?.folderColorUnread ?? current.folderColorUnread;
        const folderColorArchive = stored?.folderColorArchive ?? current.folderColorArchive;
        const messageAlignment = stored?.messageAlignment === "left" ? "left" : "right";
        return {
          ...current,
          messageTextScale: normalizeMessageTextScale(scale),
          theme,
          language,
          soundEnabled,
          soundSend,
          soundReceive,
          soundMention,
          folderLayout,
          foldersEnabled,
          showFolderPersonal,
          showFolderUnread,
          showFolderArchive,
          folderColorPersonal,
          folderColorUnread,
          folderColorArchive,
          messageAlignment,
        };
      },
    }
  )
);
