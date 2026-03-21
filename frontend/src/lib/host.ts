/**
 * Host-based site split: pingychat.com = landing + wiki, web.pingychat.com = app only.
 * URLs are driven by env so deployment works on any domain.
 */

import packageJson from "../../package.json";

const envAppUrl = import.meta.env.VITE_APP_URL || "";
const envWebAppUrl = import.meta.env.VITE_WEB_APP_URL || "";

/** Base URL of the web app (auth, chats, downloads). Used for links from the marketing site and for download links. */
export const APP_BASE_URL =
  (envWebAppUrl || envAppUrl || "https://web.pingychat.com").replace(/\/$/, "");

/** Hosts that show landing + wiki (comma-separated in VITE_MARKETING_HOSTS, or default pingychat.com). */
const MARKETING_HOSTS_RAW = import.meta.env.VITE_MARKETING_HOSTS || "pingychat.com,www.pingychat.com";
export const MARKETING_HOSTS = MARKETING_HOSTS_RAW.split(",").map((h) => h.trim()).filter(Boolean) as readonly string[];

/** True when current origin is the marketing site. */
export function isMarketingSite(): boolean {
  if (typeof window === "undefined") return false;
  return (MARKETING_HOSTS as string[]).includes(window.location.hostname);
}

/** Filename on the site: Pingy_1_3_17.apk (dots in package.json version → underscores). */
export const ANDROID_APK_FILENAME = `Pingy_${packageJson.version.replace(/\./g, "_")}.apk`;

/** Direct link to Android APK (optional VITE_ANDROID_APK_URL, else APP_BASE_URL + path). */
export const ANDROID_APK_URL =
  import.meta.env.VITE_ANDROID_APK_URL ||
  `${APP_BASE_URL}/downloads/android/${ANDROID_APK_FILENAME}`;
