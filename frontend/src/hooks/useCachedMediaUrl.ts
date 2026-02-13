import { useState, useEffect } from "react";
import { getCachedMediaUrl } from "../lib/media-cache";
import { useNetworkStore } from "../store/network";

/**
 * Hook that returns a (possibly cached) URL for a media resource.
 *
 * - Online: returns the original URL immediately, then asynchronously
 *   caches it for future offline use.
 * - Offline: returns a cached blob URL if available, otherwise the original URL.
 *
 * Usage:
 *   const cachedUrl = useCachedMediaUrl(originalUrl);
 *   <img src={cachedUrl} />
 */
export function useCachedMediaUrl(originalUrl: string | null | undefined): string {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [resolvedUrl, setResolvedUrl] = useState(originalUrl || "");

  useEffect(() => {
    if (!originalUrl) {
      setResolvedUrl("");
      return;
    }

    let cancelled = false;

    if (isOnline) {
      // Online: use original URL immediately, cache in background
      setResolvedUrl(originalUrl);
      getCachedMediaUrl(originalUrl).catch(() => {});
    } else {
      // Offline: try to load from cache
      getCachedMediaUrl(originalUrl).then((url) => {
        if (!cancelled) setResolvedUrl(url);
      }).catch(() => {
        if (!cancelled) setResolvedUrl(originalUrl);
      });
    }

    return () => { cancelled = true; };
  }, [originalUrl, isOnline]);

  return resolvedUrl;
}
