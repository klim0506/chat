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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

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
