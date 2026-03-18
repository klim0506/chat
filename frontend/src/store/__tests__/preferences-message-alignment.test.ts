/**
 * Tests for message alignment preference — verify left/right alignment logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => storage.set(key, val)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  get length() { return storage.size; },
  key: vi.fn((i: number) => [...storage.keys()][i] ?? null),
});

describe("messageAlignment preference", () => {
  let usePreferencesStore: typeof import("../preferences").usePreferencesStore;

  beforeEach(async () => {
    vi.resetModules();
    storage.clear();
    const mod = await import("../preferences");
    usePreferencesStore = mod.usePreferencesStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to right alignment", () => {
    const alignment = usePreferencesStore.getState().messageAlignment;
    expect(alignment).toBe("right");
  });

  it("setMessageAlignment('right') sets right alignment", () => {
    usePreferencesStore.getState().setMessageAlignment("right");
    expect(usePreferencesStore.getState().messageAlignment).toBe("right");
  });

  it("setMessageAlignment('left') sets left alignment", () => {
    usePreferencesStore.getState().setMessageAlignment("right");
    usePreferencesStore.getState().setMessageAlignment("left");
    expect(usePreferencesStore.getState().messageAlignment).toBe("left");
  });

  it("rowJustify: with 'right' only my messages align right; interlocutor always left", () => {
    const getRowJustify = (isMine: boolean) => {
      const messageAlignment = usePreferencesStore.getState().messageAlignment;
      const alignRight = isMine && messageAlignment === "right";
      return alignRight ? "justify-end" : "justify-start";
    };

    usePreferencesStore.getState().setMessageAlignment("right");
    expect(getRowJustify(true)).toBe("justify-end");
    expect(getRowJustify(false)).toBe("justify-start");

    usePreferencesStore.getState().setMessageAlignment("left");
    expect(getRowJustify(true)).toBe("justify-start");
    expect(getRowJustify(false)).toBe("justify-start");
  });
});
