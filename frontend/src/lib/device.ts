/**
 * Device detection for landing: suggest APK on Android, desktop app on desktop/other.
 */

import { isStandalone } from "./pwa";

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

/** True if the device is likely Android (phone/tablet). */
export function isAndroid(): boolean {
  return /Android/i.test(ua);
}

/** True when on Android in a mobile browser (not installed PWA, not native app). */
export function isAndroidMobileWeb(): boolean {
  return isAndroid() && !isStandalone();
}

/** True if the device is likely desktop (Windows, macOS, Linux). */
export function isDesktop(): boolean {
  return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(ua);
}

/** Preferred download for current device: "android" | "desktop". */
export function getPreferredDownload(): "android" | "desktop" {
  return isAndroid() ? "android" : "desktop";
}
