import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { usePreferencesStore } from "./store/preferences";
import faviconUrl from "../../ТЕЛЕГА.ico?url";

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
