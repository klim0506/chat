import { create } from "zustand";

export type PremiumPromptReason = "generic" | "folders" | "videoCircles";

interface PremiumPromptState {
  open: boolean;
  reason: PremiumPromptReason | null;
  openPrompt: (reason: PremiumPromptReason) => void;
  closePrompt: () => void;
}

export const usePremiumPromptStore = create<PremiumPromptState>((set) => ({
  open: false,
  reason: null,
  openPrompt: (reason) => set({ open: true, reason }),
  closePrompt: () => set({ open: false, reason: null }),
}));
