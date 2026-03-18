import { create } from "zustand";

interface PremiumModalState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const usePremiumModalStore = create<PremiumModalState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}));
