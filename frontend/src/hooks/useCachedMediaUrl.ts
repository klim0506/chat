import { useState, useEffect } from "react";
import { getCachedMediaUrl } from "../lib/media-cache";
import { toSameOriginMediaUrl } from "../lib/media-url";
import { useNetworkStore } from "../store/network";
import { useMediaAccess } from "./useMediaAccess";

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
  const accessibleUrl = useMediaAccess(originalUrl);
  const [resolvedUrl, setResolvedUrl] = useState(accessibleUrl || originalUrl || "");

  useEffect(() => {
    if (!accessibleUrl) {
      setResolvedUrl("");
      return;
    }

    const url = toSameOriginMediaUrl(accessibleUrl);
    let cancelled = false;

    if (isOnline) {
      setResolvedUrl(url);
      getCachedMediaUrl(url).catch(() => {});
    } else {
      // Offline: try to load from cache
      getCachedMediaUrl(url).then((cached) => {
        if (!cancelled) setResolvedUrl(cached);
      }).catch(() => {
        if (!cancelled) setResolvedUrl(url);
      });
    }

    return () => { cancelled = true; };
  }, [accessibleUrl, isOnline]);

  return resolvedUrl;
}
