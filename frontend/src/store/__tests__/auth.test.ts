/**
 * Tests for auth store: setTokens / clearTokens / sessionId extraction.
 * TOTEST §20.12
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock sessionStorage (used by persist middleware)
const storage = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => storage.set(key, val)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  get length() { return storage.size; },
  key: vi.fn((i: number) => [...storage.keys()][i] ?? null),
});

/**
 * Build a minimal JWT (unsigned) with given payload claims.
 * This mirrors what the backend produces — the frontend only decodes
 * the payload via base64, it doesn't verify the signature.
 */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const sig = "fake-sig";
  return `${header}.${body}.${sig}`;
}

describe("useAuthStore", () => {
  let useAuthStore: typeof import("../auth").useAuthStore;

  beforeEach(async () => {
    vi.resetModules();
    storage.clear();
    const mod = await import("../auth");
    useAuthStore = mod.useAuthStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("setTokens extracts sessionId from JWT sid claim", () => {
    const access = fakeJwt({ user_id: "u1", sid: "session-abc-123", type: "access" });
    const refresh = fakeJwt({ user_id: "u1", sid: "session-abc-123", type: "refresh" });

    useAuthStore.getState().setTokens(access, refresh);

    const state = useAuthStore.getState();
    expect(state.sessionId).toBe("session-abc-123");
    expect(state.isAuthenticated).toBe(true);
    expect(state.accessToken).toBe(access);
    expect(state.refreshToken).toBe(refresh);
  });

  it("setTokens with JWT without sid → sessionId is null", () => {
    const access = fakeJwt({ user_id: "u1", type: "access" });
    const refresh = fakeJwt({ user_id: "u1", type: "refresh" });

    useAuthStore.getState().setTokens(access, refresh);

    expect(useAuthStore.getState().sessionId).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("setTokens with user object stores it", () => {
    const access = fakeJwt({ user_id: "u1", sid: "s1", type: "access" });
    const refresh = fakeJwt({ user_id: "u1", sid: "s1", type: "refresh" });
    const user = { id: "u1", phone: "+7999", display_name: "Test" };

    useAuthStore.getState().setTokens(access, refresh, user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
  });

  it("clearTokens resets sessionId to null", () => {
    const access = fakeJwt({ user_id: "u1", sid: "session-xyz", type: "access" });
    const refresh = fakeJwt({ user_id: "u1", sid: "session-xyz", type: "refresh" });

    useAuthStore.getState().setTokens(access, refresh);
    expect(useAuthStore.getState().sessionId).toBe("session-xyz");

    useAuthStore.getState().clearTokens();

    const state = useAuthStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});
