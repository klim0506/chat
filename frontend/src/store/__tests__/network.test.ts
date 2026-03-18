/**
 * Tests for network store.
 * TOTEST §8.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to set up navigator.onLine before importing the store
// because the store reads it at module init time.

describe("useNetworkStore", () => {
  let useNetworkStore: typeof import("../network").useNetworkStore;

  beforeEach(async () => {
    // Reset module cache so each test gets fresh module init
    vi.resetModules();

    // Default: online
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

    const mod = await import("../network");
    useNetworkStore = mod.useNetworkStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial state matches navigator.onLine", () => {
    expect(useNetworkStore.getState().isOnline).toBe(true);
  });

  it("responds to online event", () => {
    // Simulate going offline then online
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    useNetworkStore.setState({ isOnline: false });
    expect(useNetworkStore.getState().isOnline).toBe(false);

    // Simulate browser firing 'online'
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    expect(useNetworkStore.getState().isOnline).toBe(true);
  });

  it("responds to offline event", () => {
    expect(useNetworkStore.getState().isOnline).toBe(true);

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    expect(useNetworkStore.getState().isOnline).toBe(false);
  });
});
