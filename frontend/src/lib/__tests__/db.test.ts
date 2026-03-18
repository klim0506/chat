/**
 * Tests for AppDatabase (Dexie / IndexedDB).
 * TOTEST §8.1: AppDatabase creates tables chats, messages, outbox, syncMeta.
 *
 * We use fake-indexeddb to provide an in-memory IndexedDB in node/jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// fake-indexeddb is not needed in Dexie v4 with node environment —
// Dexie uses IndexedDBShim. We simply verify the database schema.

describe("AppDatabase", () => {
  let db: typeof import("../db").db;

  beforeAll(async () => {
    // Dexie in Node requires indexedDB polyfill. Import fake-indexeddb if available,
    // otherwise skip with a lightweight schema check.
    try {
      // Dexie supports a fake indexedDB for testing via 'fake-indexeddb'
      const fakeIDB = await import("fake-indexeddb");
      const fakeIDBKeyRange = await import("fake-indexeddb/lib/FDBKeyRange");
      globalThis.indexedDB = fakeIDB.default;
      globalThis.IDBKeyRange = fakeIDBKeyRange.default;
    } catch {
      // If fake-indexeddb is not installed, we'll do a structural check
    }
    const mod = await import("../db");
    db = mod.db;
  });

  afterAll(async () => {
    try {
      await db.delete();
    } catch {
      // ignore cleanup errors
    }
  });

  it("has chats table defined", () => {
    expect(db.chats).toBeDefined();
    expect(db.chats.name).toBe("chats");
  });

  it("has messages table defined", () => {
    expect(db.messages).toBeDefined();
    expect(db.messages.name).toBe("messages");
  });

  it("has outbox table defined", () => {
    expect(db.outbox).toBeDefined();
    expect(db.outbox.name).toBe("outbox");
  });

  it("has syncMeta table defined", () => {
    expect(db.syncMeta).toBeDefined();
    expect(db.syncMeta.name).toBe("syncMeta");
  });

  it("has E2EE tables defined (v2 schema)", () => {
    expect(db.identityKeyPair).toBeDefined();
    expect(db.signedPreKeys).toBeDefined();
    expect(db.preKeys).toBeDefined();
    expect(db.sessions).toBeDefined();
    expect(db.trustedIdentities).toBeDefined();
  });

  it("schema version is at least 2", () => {
    expect(db.verno).toBeGreaterThanOrEqual(2);
  });
});
