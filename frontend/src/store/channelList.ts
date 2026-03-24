import { create } from "zustand";
import { channelsApi, type Channel, type PaginatedResponse } from "../api/client";
import { db, type CachedChannel } from "../lib/db";
import { useAuthStore } from "./auth";

interface ChannelListState {
  channels: Channel[];
  loading: boolean;
  error: string | null;
  loadChannels: () => Promise<boolean>;
  setChannels: (channels: Channel[]) => void;
  upsertChannel: (channel: Channel, updates?: Partial<Channel>) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  removeChannel: (channelId: string) => void;
  reset: () => void;
}

const CHANNEL_LIST_PAGE_SIZE = 50;

export const useChannelListStore = create<ChannelListState>()((set, get) => ({
  channels: [],
  loading: true,
  error: null,

  loadChannels: async (): Promise<boolean> => {
    const hasChannels = get().channels.length > 0;
    set({ loading: !hasChannels, error: null });
    const currentUserId = useAuthStore.getState().user?.id;

    try {
      const cached = await db.channels.toArray();
      const legacyIds = cached.filter((c) => !c._userId).map((c) => c.id);
      if (legacyIds.length > 0) {
        db.channels.bulkDelete(legacyIds).catch(() => {});
      }
      const owned = currentUserId ? cached.filter((c) => c._userId === currentUserId) : [];
      if (owned.length > 0) {
        const channels = owned.slice().sort(sortCachedChannels).map(stripCacheMeta);
        set({ channels, loading: false });
      }
    } catch {
      // IndexedDB unavailable — proceed with network only
    }

    try {
      const existingById = new Map(get().channels.map((c) => [c.id, c]));
      let page = 1;
      let nextUrl: string | null = null;
      let fetchedOrder: Channel[] = [];

      do {
        const data: PaginatedResponse<Channel> = page === 1
          ? (await channelsApi.list({ limit: CHANNEL_LIST_PAGE_SIZE })).data
          : (await channelsApi.listByUrl(nextUrl!)).data;
        const pageRows = data.results ?? [];
        fetchedOrder = mergeOrderedUnique(fetchedOrder, pageRows);
        const mergedForUi = mergeForSmoothReorder(fetchedOrder, existingById);
        set({ channels: mergedForUi, loading: false, error: null });
        nextUrl = data.next ?? null;
        page += 1;
      } while (nextUrl);

      set({ channels: fetchedOrder, loading: false, error: null });
      persistChannels(fetchedOrder).catch(() => {});
      return true;
    } catch {
      if (get().channels.length === 0) {
        set({ error: "dashboard.loadError", loading: false });
      } else {
        set({ loading: false });
      }
      return false;
    }
  },

  setChannels: (channels) => {
    set({ channels });
    persistChannels(channels).catch(() => {});
  },

  upsertChannel: (channel, updates) => {
    const merged = { ...channel, ...(updates || {}) };
    set((state) => {
      const idx = state.channels.findIndex((c) => c.id === channel.id);
      if (idx === -1) return { channels: [merged, ...state.channels] };
      const next = [...state.channels];
      next[idx] = { ...next[idx], ...channel, ...(updates || {}) };
      return { channels: next };
    });
    persistChannel(merged as Channel).catch(() => {});
  },

  updateChannel: (channelId, updates) => {
    set((state) => ({
      channels: state.channels.map((c) => (c.id === channelId ? { ...c, ...updates } : c)),
    }));
    const channel = get().channels.find((c) => c.id === channelId);
    if (channel) persistChannel({ ...channel, ...updates } as Channel).catch(() => {});
  },

  removeChannel: (channelId) => {
    set((state) => ({ channels: state.channels.filter((c) => c.id !== channelId) }));
    db.channels.delete(channelId).catch(() => {});
  },

  reset: () => {
    set({ channels: [], loading: true, error: null });
    db.channels.clear().catch(() => {});
  },
}));

function stripCacheMeta(cached: CachedChannel): Channel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _cachedAt, _listPos, ...channel } = cached;
  return channel;
}

async function persistChannels(channels: Channel[]) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const now = new Date().toISOString();
  const rows: CachedChannel[] = channels.map((c, index) => ({
    ...c,
    _cachedAt: now,
    _userId: userId,
    _listPos: index,
  }));
  await db.channels.bulkPut(rows);
}

async function persistChannel(channel: Channel) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const prev = await db.channels.get(channel.id).catch(() => undefined);
  const row: CachedChannel = {
    ...channel,
    _cachedAt: new Date().toISOString(),
    _userId: userId,
    _listPos: prev?._listPos,
  };
  await db.channels.put(row);
}

function sortCachedChannels(a: CachedChannel, b: CachedChannel): number {
  if (typeof a._listPos === "number" && typeof b._listPos === "number") return a._listPos - b._listPos;
  if (typeof a._listPos === "number") return -1;
  if (typeof b._listPos === "number") return 1;
  return toMs(b.last_post_at || b.created_at) - toMs(a.last_post_at || a.created_at);
}

function mergeOrderedUnique(base: Channel[], next: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const channel of [...base, ...next]) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push(channel);
  }
  return out;
}

function mergeForSmoothReorder(fetchedOrder: Channel[], existingById: Map<string, Channel>): Channel[] {
  const head = fetchedOrder.map((ch) => ({ ...(existingById.get(ch.id) || {}), ...ch }));
  const fetchedIds = new Set(head.map((c) => c.id));
  const tail = [...existingById.values()].filter((c) => !fetchedIds.has(c.id));
  return [...head, ...tail];
}

function toMs(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}
