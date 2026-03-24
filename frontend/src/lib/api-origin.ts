/**
 * In the browser on web.pingychat.com, API is same-origin (/api). In Tauri the page
 * origin is https://tauri.localhost — relative /api never hits the backend unless
 * we use an absolute API base (same as the web app: APP_BASE_URL).
 */

import { APP_BASE_URL } from "./host";

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined;
}

/** HTTP(S) origin for /api, without trailing slash. Empty = use same-origin /api (Vite dev or web prod). */
export function resolveApiOrigin(): string {
  const explicit = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (import.meta.env.DEV) return "";
  const desktopBundle = import.meta.env.VITE_CLIENT_TYPE === "desktop";
  if (desktopBundle || isTauriRuntime()) {
    return APP_BASE_URL.replace(/\/$/, "");
  }
  return "";
}

/** HTTP(S) base for WebSocket URL (before ws/wss swap). Falls back to API origin when VITE_WS_URL unset. */
export function resolveWsHttpBase(): string {
  const explicit = (import.meta.env.VITE_WS_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  return resolveApiOrigin();
}
