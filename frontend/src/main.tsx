import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { usePreferencesStore } from "./store/preferences";

const faviconUrl = "/ico_png_ai_16x16.ico";

function syncDocumentPrefs() {
  const { theme, language } = usePreferencesStore.getState();
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("lang", language);
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
        console.log("[SW] registered, scope:", reg.scope);
        setInterval(() => reg.update(), 30 * 60 * 1000);
      })
      .catch((err) => console.warn("[SW] registration failed:", err));
  });
}
