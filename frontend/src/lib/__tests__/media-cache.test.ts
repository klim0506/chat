/**
 * Tests for media cache (Cache API).
 * TOTEST §8.4
 *
 * jsdom does not implement the Cache API, so we mock it fully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- In-memory Cache mock ---

const cacheStore = new Map<string, Response>();

const mockCache = {
  match: vi.fn(async (url: string) => cacheStore.get(url) ?? undefined),
  put: vi.fn(async (url: string, response: Response) => {
    cacheStore.set(url, response.clone());
  }),
  delete: vi.fn(async (url: string) => cacheStore.delete(url)),
  keys: vi.fn(async () => [...cacheStore.keys()].map((url) => new Request(url))),
};

const mockCaches = {
  open: vi.fn(async () => mockCache),
  delete: vi.fn(async () => { cacheStore.clear(); return true; }),
};

vi.stubGlobal("caches", mockCaches);

// Mock URL.createObjectURL / revokeObjectURL (keep the original URL constructor intact)
globalThis.URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock/${blob.size}`);
globalThis.URL.revokeObjectURL = vi.fn();

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("media-cache", () => {
  let getCachedMediaUrl: typeof import("../media-cache").getCachedMediaUrl;
  let isMediaCached: typeof import("../media-cache").isMediaCached;
  let clearMediaCache: typeof import("../media-cache").clearMediaCache;
  let getMediaCacheSize: typeof import("../media-cache").getMediaCacheSize;

  beforeEach(async () => {
    vi.resetModules();
    cacheStore.clear();
    fetchMock.mockReset();

    const mod = await import("../media-cache");
    getCachedMediaUrl = mod.getCachedMediaUrl;
    isMediaCached = mod.isMediaCached;
    clearMediaCache = mod.clearMediaCache;
    getMediaCacheSize = mod.getMediaCacheSize;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("first call fetches from network and caches", async () => {
    const blob = new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
    const response = new Response(blob, { status: 200 });
    fetchMock.mockResolvedValueOnce(response);

    const url = await getCachedMediaUrl("https://example.com/photo.jpg");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(url).toContain("blob:");
    expect(mockCache.put).toHaveBeenCalled();
  });

  it("second call returns from cache (no network)", async () => {
    // Seed the cache
    const blob = new Blob([new Uint8Array(512)], { type: "image/jpeg" });
    cacheStore.set("https://example.com/cached.jpg", new Response(blob));

    const url = await getCachedMediaUrl("https://example.com/cached.jpg");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(url).toContain("blob:");
  });

  it("clearMediaCache clears everything", async () => {
    cacheStore.set("https://example.com/a.jpg", new Response(new Blob([])));
    await clearMediaCache();
    expect(cacheStore.size).toBe(0);
  });
});
