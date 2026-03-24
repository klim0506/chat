/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  /** Main app URL (canonical, og:url). Also used as APP_BASE_URL if VITE_WEB_APP_URL is not set. */
  readonly VITE_APP_URL: string;
  readonly VITE_ALPHA_BANNER_ENABLED: string;
  /** Base URL for web app (auth, chats, downloads). If set, used for APP_BASE_URL; else VITE_APP_URL. */
  readonly VITE_WEB_APP_URL: string;
  /** When true, landing is on root domain; / redirects to /auth or /chats. Set for web.pingychat.com build. */
  readonly VITE_LANDING_AT_ROOT: string;
  /** Comma-separated hostnames that show landing+wiki (default: pingychat.com,www.pingychat.com). */
  readonly VITE_MARKETING_HOSTS: string;
  /** Direct URL to Android APK; if not set, APP_BASE_URL/downloads/android/Pingy_{version}.apk is used. */
  readonly VITE_ANDROID_APK_URL: string;
  /** `web` (default) or `desktop` — desktop uses absolute API base in production (Tauri). */
  readonly VITE_CLIENT_TYPE: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }

interface AndroidNotificationsBridge {
  isAndroidApp(): boolean;
  getNotificationPermission(): "granted" | "denied" | "default";
  requestNotificationPermission(): void;
  showMessageNotification(
    chatTitle: string,
    sender: string,
    body: string,
    chatId: string,
    timestampMs: string,
  ): void;
}

interface Window {
  PingyAndroid?: AndroidNotificationsBridge;
}

declare module "libsodium-wrappers-sumo" {
  const mod: any;
  export default mod;
}

declare module "@default-chat-bg" {
  const src: string;
  export default src;
}

declare module "*.ico?url" {
  const url: string;
  export default url;
}
