import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { usePreferencesStore } from "./store/preferences";
import type { AppTheme } from "./store/preferences";
import { DEFAULT_MESSAGE_TEXT_SCALE, normalizeMessageTextScale } from "./store/preferences";

const faviconUrl = "/ico_png_ai_16x16.ico";
const themeColorByTheme: Record<AppTheme, string> = {
  light: "#f4f7fb",
  dark: "#08111d",
};

function readPersistedDocumentPrefs() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("preferences");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown; language?: unknown; messageTextScale?: unknown } } | null;
    const theme = parsed?.state?.theme === "dark" ? "dark" : parsed?.state?.theme === "light" ? "light" : null;
    const language =
      parsed?.state?.language === "ru" ? "ru" : parsed?.state?.language === "en" ? "en" : null;
    const messageTextScale =
      parsed?.state?.messageTextScale == null
        ? null
        : normalizeMessageTextScale(parsed.state.messageTextScale);
    if (!theme && !language && messageTextScale == null) return null;
    return { theme, language, messageTextScale };
  } catch {
    return null;
  }
}

function syncDocumentPrefs() {
  const { theme: storeTheme, language: storeLanguage, messageTextScale: storeMessageTextScale } = usePreferencesStore.getState();
  const persisted = readPersistedDocumentPrefs();
  const hydrated = typeof usePreferencesStore.persist?.hasHydrated === "function"
    ? usePreferencesStore.persist.hasHydrated()
    : true;
  const theme: AppTheme = (hydrated ? storeTheme : (persisted?.theme ?? storeTheme)) === "dark" ? "dark" : "light";
  const language = hydrated ? storeLanguage : (persisted?.language ?? storeLanguage);
  const messageTextScale = hydrated
    ? normalizeMessageTextScale(storeMessageTextScale)
    : normalizeMessageTextScale(persisted?.messageTextScale ?? storeMessageTextScale ?? DEFAULT_MESSAGE_TEXT_SCALE);
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("lang", language);
  document.documentElement.style.fontSize = `${messageTextScale * 100}%`;
  let themeColorMeta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (!themeColorMeta) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.name = "theme-color";
    document.head.appendChild(themeColorMeta);
  }
  themeColorMeta.content = themeColorByTheme[theme];
  let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }
  favicon.href = faviconUrl;
}

syncDocumentPrefs();
usePreferencesStore.subscribe(syncDocumentPrefs);
usePreferencesStore.persist?.onFinishHydration?.(() => {
  syncDocumentPrefs();
});

function setupSplashHideController() {
  if (typeof window === "undefined") return null;
  const splash = document.getElementById("app-splash");
  if (!splash) return null;

  const startedAt = performance.now();
  const pathname = window.location.pathname;
  const shouldWaitForChatsReady =
    pathname === "/chats"
    || pathname === "/chats/settings"
    || pathname.startsWith("/chat/")
    || pathname.startsWith("/channel/");
  const MIN_VISIBLE_MS = 2000;
  const MAX_VISIBLE_MS = 2000;
  const FADE_OUT_MS = 260;
  let isDone = false;

  const hideSplash = () => {
    if (isDone) return;
    isDone = true;
    splash.classList.add("app-splash--hidden");
    window.setTimeout(() => splash.remove(), FADE_OUT_MS);
  };

  const requestHide = () => {
    if (isDone) return;
    const elapsed = performance.now() - startedAt;
    const minRemaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const maxRemaining = Math.max(0, MAX_VISIBLE_MS - elapsed);
    const waitMs = Math.min(minRemaining, maxRemaining);
    window.setTimeout(hideSplash, waitMs);
  };

  if (shouldWaitForChatsReady) {
    window.addEventListener("app:chats-ready", requestHide, { once: true });
    return { requestHide, shouldAutoHideAfterMount: false };
  }

  const hardStopDelay = Math.max(0, MAX_VISIBLE_MS - (performance.now() - startedAt));
  window.setTimeout(hideSplash, hardStopDelay);
  return { requestHide, shouldAutoHideAfterMount: true };
}

const splashController = setupSplashHideController();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if (splashController?.shouldAutoHideAfterMount) {
  // Hide splash after the app shell has been painted.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      splashController.requestHide();
    });
  });
}

// ─── Service Worker registration (PWA) ──────────────────────────────────
// Controlled by VITE_PWA_INSTALL_ENABLED env variable.
// Without SW the browser won't offer the install prompt.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  import.meta.env.VITE_PWA_INSTALL_ENABLED === "true"
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (import.meta.env.DEV) console.log("[SW] registered, scope:", reg.scope);
        setInterval(() => reg.update(), 30 * 60 * 1000);
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn("[SW] registration failed:", err);
      });
  });
}
