/**
 * PWA (Progressive Web App) helpers.
 *
 * Detects standalone mode (installed app), manages the install prompt,
 * and provides badge/notification helpers that work in both browser and PWA.
 *
 * Set VITE_PWA_INSTALL_ENABLED=true in .env to enable the install prompt
 * and service worker registration. When disabled, the app works as a
 * normal website — no install prompt, no SW, no offline support.
 */

/** Whether the PWA install flow is enabled (env flag). */
export const PWA_INSTALL_ENABLED =
  import.meta.env.VITE_PWA_INSTALL_ENABLED === "true";

/** Returns true when the app is running as an installed PWA (standalone window). */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Set the app badge count (unread messages).
 * Uses the Badging API when available (Chrome/Edge PWA).
 */
export function setAppBadge(count: number): void {
  if ("setAppBadge" in navigator) {
    if (count > 0) {
      (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> })
        .setAppBadge(count)
        .catch(() => {});
    } else {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge()
        .catch(() => {});
    }
  }
}

/**
 * Show a notification. Requests permission if not yet granted.
 * Works in both browser and installed PWA.
 */
export async function showNotification(
  title: string,
  body: string,
  icon?: string
): Promise<void> {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    // In PWA with active service worker, use SW notifications (persist after tab close)
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      reg.showNotification(title, {
        body,
        icon: icon || "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
      });
    } else {
      new Notification(title, { body, icon: icon || "/icons/icon-192x192.png" });
    }
  }
}

// ─── Install prompt handling ─────────────────────────────────────────────

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installPromptListeners: Array<(available: boolean) => void> = [];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

if (typeof window !== "undefined" && PWA_INSTALL_ENABLED) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installPromptListeners.forEach((fn) => fn(true));
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installPromptListeners.forEach((fn) => fn(false));
  });
}

/** Returns true if the browser install prompt is available. */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/** Triggers the browser's native install dialog. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installPromptListeners.forEach((fn) => fn(false));
  return outcome === "accepted";
}

/** Subscribe to install prompt availability changes. Returns unsubscribe function. */
export function onInstallAvailableChange(
  fn: (available: boolean) => void
): () => void {
  installPromptListeners.push(fn);
  return () => {
    installPromptListeners = installPromptListeners.filter((f) => f !== fn);
  };
}
