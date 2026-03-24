import Dexie, { type Table } from "dexie";
import type { Chat, Channel, Message } from "../api/client";

/* ------------------------------------------------------------------ */
/*  Cached types — mirror API shapes, add indexing / sync metadata     */
/* ------------------------------------------------------------------ */

/** Chat row cached in IndexedDB — same shape as API Chat. */
export type CachedChat = Chat & {
  /** ISO timestamp of last sync from server for this chat entry */
  _cachedAt?: string;
  /** Owner user ID — prevents cross-account cache leaks */
  _userId?: string;
  /** Position in server-ordered chat list (for instant startup ordering). */
  _listPos?: number;
};

/** Channel row cached in IndexedDB — same shape as API Channel. */
export type CachedChannel = Channel & {
  /** ISO timestamp of last sync from server for this channel entry */
  _cachedAt?: string;
  /** Owner user ID — prevents cross-account cache leaks */
  _userId?: string;
  /** Position in server-ordered channel list (for instant startup ordering). */
  _listPos?: number;
};

/** Message row cached in IndexedDB — same shape as API Message + chatId for indexing. */
export type CachedMessage = Message & {
  /** Denormalised from Message.chat for compound-index queries */
  chatId: string;
  /** Owner user ID — prevents cross-account cache leaks */
  _userId?: string;
};

/** Pending message queued for send when offline. */
export interface OutboxItem {
  /** Client-generated UUID (crypto.randomUUID()) */
  id: string;
  chatId: string;
  msgType: string;
  content: string;
  fileIds?: string[];
  /** Raw file blobs for offline file uploads (limited budget ~50 MB total) */
  fileBlobs?: Blob[];
  fileNames?: string[];
  /** Waveform data for audio messages */
  waveform?: number[];
  /** Date.now() — for ordering */
  createdAt: number;
  status: "pending" | "sending" | "failed";
  retries: number;
  /** Last error message (for UI) */
  lastError?: string;
}

/** Per-chat sync cursor — tracks the newest cached message timestamp. */
export interface SyncMeta {
  chatId: string;
  /** ISO timestamp of the newest message we have in cache for this chat */
  lastMessageAt: string;
  /** ISO timestamp of last successful full sync */
  lastFullSyncAt: string;
}

/* ------------------------------------------------------------------ */
/*  Database definition                                                */
/* ------------------------------------------------------------------ */

/** E2EE: Identity key pair (Ed25519). id = 'local'. */
export interface CachedIdentityKeyPair {
  id: string;
  publicKey: string;
  privateKey: string;
}

/** E2EE: Signed prekey (X25519). */
export interface CachedSignedPreKey {
  keyId: number;
  publicKey: string;
  privateKey: string;
  signature: string;
  createdAt: number;
}

/** E2EE: One-time prekey (X25519). */
export interface CachedPreKey {
  keyId: number;
  publicKey: string;
  privateKey: string;
}

/** E2EE: Double Ratchet session state. id = `${remoteUserId}:${remoteDeviceId}` */
export interface CachedSession {
  id: string;
  remoteUserId: string;
  remoteDeviceId: number;
  ratchetState: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** E2EE: Trusted identity (for safety numbers). */
export interface CachedTrustedIdentity {
  userId: string;
  identityKey: string;
  verified: boolean;
  firstSeen: number;
}

class AppDatabase extends Dexie {
  chats!: Table<CachedChat, string>;
  channels!: Table<CachedChannel, string>;
  messages!: Table<CachedMessage, string>;
  outbox!: Table<OutboxItem, string>;
  syncMeta!: Table<SyncMeta, string>;
  identityKeyPair!: Table<CachedIdentityKeyPair, string>;
  signedPreKeys!: Table<CachedSignedPreKey, number>;
  preKeys!: Table<CachedPreKey, number>;
  sessions!: Table<CachedSession, string>;
  trustedIdentities!: Table<CachedTrustedIdentity, string>;

  constructor() {
    super("LocalChatsDB");

    this.version(1).stores({
      chats: "id",
      messages: "id, chatId, [chatId+created_at]",
      outbox: "id, chatId, status",
      syncMeta: "chatId",
    });

    this.version(2).stores({
      chats: "id",
      messages: "id, chatId, [chatId+created_at]",
      outbox: "id, chatId, status",
      syncMeta: "chatId",
      identityKeyPair: "id",
      signedPreKeys: "keyId",
      preKeys: "keyId",
      sessions: "id, [remoteUserId+remoteDeviceId]",
      trustedIdentities: "userId",
    });

    this.version(3).stores({
      chats: "id, _userId",
      messages: "id, chatId, [chatId+created_at]",
      outbox: "id, chatId, status",
      syncMeta: "chatId",
      identityKeyPair: "id",
      signedPreKeys: "keyId",
      preKeys: "keyId",
      sessions: "id, [remoteUserId+remoteDeviceId]",
      trustedIdentities: "userId",
    });

    this.version(4).stores({
      chats: "id, _userId",
      channels: "id, _userId",
      messages: "id, chatId, [chatId+created_at]",
      outbox: "id, chatId, status",
      syncMeta: "chatId",
      identityKeyPair: "id",
      signedPreKeys: "keyId",
      preKeys: "keyId",
      sessions: "id, [remoteUserId+remoteDeviceId]",
      trustedIdentities: "userId",
    });
  }
}

export const db = new AppDatabase();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert a Message from the API into a CachedMessage with denormalised chatId. */
export function toCachedMessage(msg: Message, userId?: string): CachedMessage {
  return { ...msg, chatId: msg.chat, _userId: userId };
}

/** Generate a client-side UUID (uses crypto.randomUUID where available). */
export function clientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
