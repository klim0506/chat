/**
 * Media cache using the Cache API (available from main thread, no Service Worker needed).
 *
 * Caches viewed images, audio, and video files with LRU eviction
 * to keep the cache within a budget (~200 MB default).
 */

const CACHE_NAME = "media-cache-v1";
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB budget

/* ------------------------------------------------------------------ */
/*  LRU tracking (in-memory; lightweight — lost on page reload)        */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  url: string;
  sizeBytes: number;
  lastAccessed: number; // Date.now()
}

const lruMap = new Map<string, CacheEntry>();
let totalBytes = 0;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Get a cached URL for a media resource. If not cached, fetches it,
 * stores in cache, and returns a blob URL.
 *
 * Falls back to the original URL if the Cache API is unavailable
 * or the fetch fails.
 */
export async function getCachedMediaUrl(originalUrl: string): Promise<string> {
  if (!isCacheApiAvailable()) return originalUrl;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(originalUrl);

    if (cached) {
      // Update LRU access time
      const entry = lruMap.get(originalUrl);
      if (entry) entry.lastAccessed = Date.now();
      // Return blob URL from cache
      const blob = await cached.blob();
      return URL.createObjectURL(blob);
    }

    // Not cached — fetch and store
    const response = await fetch(originalUrl);
    if (!response.ok) return originalUrl;

    const cloned = response.clone();
    const blob = await response.blob();
    const size = blob.size;

    // Evict if needed before storing
    await evictIfNeeded(size);

    // Store in cache
    await cache.put(originalUrl, cloned);

    // Track in LRU
    lruMap.set(originalUrl, { url: originalUrl, sizeBytes: size, lastAccessed: Date.now() });
    totalBytes += size;

    return URL.createObjectURL(blob);
  } catch {
    return originalUrl;
  }
}

/**
 * Check if a URL is already in the media cache.
 */
export async function isMediaCached(url: string): Promise<boolean> {
  if (!isCacheApiAvailable()) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    return match !== undefined;
  } catch {
    return false;
  }
}

/**
 * Pre-cache a media URL in the background (fire and forget).
 */
export function precacheMedia(url: string): void {
  getCachedMediaUrl(url).catch(() => {});
}

/**
 * Clear the entire media cache.
 */
export async function clearMediaCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
    lruMap.clear();
    totalBytes = 0;
  } catch {
    // ignore
  }
}

/**
 * Get approximate total cache size in bytes.
 */
export function getMediaCacheSize(): number {
  return totalBytes;
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function isCacheApiAvailable(): boolean {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}

async function evictIfNeeded(incomingBytes: number): Promise<void> {
  while (totalBytes + incomingBytes > MAX_CACHE_BYTES && lruMap.size > 0) {
    // Find the least recently accessed entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of lruMap) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (!oldestKey) break;

    const entry = lruMap.get(oldestKey)!;
    lruMap.delete(oldestKey);
    totalBytes -= entry.sizeBytes;

    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(entry.url);
    } catch {
      // ignore eviction errors
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Initialize LRU from existing cache (runs once on import)           */
/* ------------------------------------------------------------------ */

async function initLruFromCache(): Promise<void> {
  if (!isCacheApiAvailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const url = request.url;
        lruMap.set(url, {
          url,
          sizeBytes: blob.size,
          lastAccessed: Date.now(), // Approximate — real access time lost on reload
        });
        totalBytes += blob.size;
      }
    }
  } catch {
    // Cache API not available or error — start fresh
  }
}

// Fire and forget initialization
initLruFromCache();
