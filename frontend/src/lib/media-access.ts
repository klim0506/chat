import { api } from "../api/client";
import { isDirectMediaUrl, isOpaqueMediaHandle } from "./media-url";

export interface MediaAccessPayload {
  url: string;
  expires_at: string;
}

type MediaAccessCacheEntry = {
  url: string;
  expiresAtMs: number;
};

const mediaAccessCache = new Map<string, MediaAccessCacheEntry>();
const mediaAccessInflight = new Map<string, Promise<MediaAccessCacheEntry>>();
const REFRESH_SKEW_MS = 2 * 60 * 1000;

function parseExpiry(expiresAt: string | null | undefined): number {
  const parsed = Date.parse(expiresAt || "");
  return Number.isFinite(parsed) ? parsed : Date.now() + 15 * 60 * 1000;
}

function isFresh(entry: MediaAccessCacheEntry | undefined): entry is MediaAccessCacheEntry {
  return !!entry && entry.expiresAtMs - REFRESH_SKEW_MS > Date.now();
}

export async function resolveMediaAccess(source: string | null | undefined): Promise<string> {
  const raw = (source || "").trim();
  if (!raw) return "";
  if (isDirectMediaUrl(raw)) return raw;
  if (!isOpaqueMediaHandle(raw)) return "";

  const cached = mediaAccessCache.get(raw);
  if (isFresh(cached)) return cached.url;

  const existing = mediaAccessInflight.get(raw);
  if (existing) {
    const shared = await existing;
    return shared.url;
  }

  const request = api
    .get<MediaAccessPayload>("/media/access/", { params: { handle: raw } })
    .then((res) => {
      const entry: MediaAccessCacheEntry = {
        url: res.data.url,
        expiresAtMs: parseExpiry(res.data.expires_at),
      };
      mediaAccessCache.set(raw, entry);
      mediaAccessInflight.delete(raw);
      return entry;
    })
    .catch((error) => {
      mediaAccessInflight.delete(raw);
      throw error;
    });

  mediaAccessInflight.set(raw, request);
  const entry = await request;
  return entry.url;
}

export function clearMediaAccessCache(): void {
  mediaAccessCache.clear();
  mediaAccessInflight.clear();
}
