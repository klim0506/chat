import { create } from "zustand";

interface NetworkState {
  /** Whether the browser currently has network connectivity */
  isOnline: boolean;
}

export const useNetworkStore = create<NetworkState>()(() => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
}));

/* ------------------------------------------------------------------ */
/*  Auto-subscribe to browser online/offline events (module scope)     */
/* ------------------------------------------------------------------ */

if (typeof window !== "undefined") {
  const update = () => {
    useNetworkStore.setState({ isOnline: navigator.onLine });
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}
