/**
 * Tests for outbox store: enqueue, status management.
 * TOTEST §8.2
 *
 * We mock external dependencies (IndexedDB, API calls, messages store)
 * to test the outbox store logic in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock dependencies before importing the store ---

// Mock Dexie / db
vi.mock("../../lib/db", () => ({
  db: {
    outbox: {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      toArray: vi.fn().mockResolvedValue([]),
    },
  },
  clientId: vi.fn(() => `temp-${Date.now()}-${Math.random()}`),
}));

// Mock API
vi.mock("../../api/client", () => ({
  messagesApi: {
    create: vi.fn().mockResolvedValue({ data: { id: "server-id-1" } }),
  },
  filesApi: {
    upload: vi.fn().mockResolvedValue({ data: { id: "file-id-1" } }),
  },
}));

// Mock messages store
vi.mock("../messages", () => ({
  useMessagesStore: {
    getState: vi.fn().mockReturnValue({
      upsertMessage: vi.fn(),
      replaceTempMessage: vi.fn(),
    }),
  },
  normalizeMessage: vi.fn((m: unknown) => m),
}));

// We need to set navigator.onLine and network store
Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

describe("useOutboxStore", () => {
  let useOutboxStore: typeof import("../outbox").useOutboxStore;

  beforeEach(async () => {
    vi.resetModules();
    // Re-import to get fresh store instance
    const mod = await import("../outbox");
    useOutboxStore = mod.useOutboxStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueue adds item and starts sending", () => {
    const id = useOutboxStore.getState().enqueue({
      chatId: "chat-1",
      msgType: "text",
      content: "hello",
    });
    expect(id).toBeTruthy();
    const items = useOutboxStore.getState().items;
    const item = items.find((i) => i.id === id);
    expect(item).toBeDefined();
    // enqueue starts sendItem immediately when online, which sets status to "sending"
    expect(["pending", "sending"]).toContain(item!.status);
    expect(item!.content).toBe("hello");
  });

  it("remove removes item from store", () => {
    const id = useOutboxStore.getState().enqueue({
      chatId: "chat-1",
      msgType: "text",
      content: "remove me",
    });
    expect(useOutboxStore.getState().items.length).toBeGreaterThan(0);
    useOutboxStore.getState().remove(id);
    expect(useOutboxStore.getState().items.find((i) => i.id === id)).toBeUndefined();
  });

  it("markFailed sets status to failed", () => {
    const id = useOutboxStore.getState().enqueue({
      chatId: "chat-1",
      msgType: "text",
      content: "fail me",
    });
    useOutboxStore.getState().markFailed(id, "Network error");
    const item = useOutboxStore.getState().items.find((i) => i.id === id);
    expect(item!.status).toBe("failed");
    expect(item!.lastError).toBe("Network error");
  });

  it("forChat filters by chatId", () => {
    useOutboxStore.getState().enqueue({ chatId: "chat-1", msgType: "text", content: "a" });
    useOutboxStore.getState().enqueue({ chatId: "chat-2", msgType: "text", content: "b" });
    useOutboxStore.getState().enqueue({ chatId: "chat-1", msgType: "text", content: "c" });
    expect(useOutboxStore.getState().forChat("chat-1").length).toBe(2);
    expect(useOutboxStore.getState().forChat("chat-2").length).toBe(1);
  });

  it("reset clears all items", () => {
    useOutboxStore.getState().enqueue({ chatId: "chat-1", msgType: "text", content: "x" });
    useOutboxStore.getState().reset();
    expect(useOutboxStore.getState().items.length).toBe(0);
  });
});
