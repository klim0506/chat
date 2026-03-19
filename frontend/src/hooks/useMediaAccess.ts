import { useEffect, useState } from "react";
import { resolveMediaAccess } from "../lib/media-access";
import { isDirectMediaUrl } from "../lib/media-url";

interface UseMediaAccessOptions {
  enabled?: boolean;
}

export function useMediaAccess(source: string | null | undefined, options?: UseMediaAccessOptions): string {
  const enabled = options?.enabled ?? true;
  const [resolvedUrl, setResolvedUrl] = useState(() => {
    if (!source) return "";
    return isDirectMediaUrl(source) ? source : "";
  });

  useEffect(() => {
    let cancelled = false;
    const raw = (source || "").trim();
    if (!raw) {
      setResolvedUrl("");
      return;
    }
    if (isDirectMediaUrl(raw)) {
      setResolvedUrl(raw);
      return;
    }
    if (!enabled) {
      setResolvedUrl("");
      return;
    }

    resolveMediaAccess(raw)
      .then((url) => {
        if (!cancelled) setResolvedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [source, enabled]);

  return resolvedUrl;
}
