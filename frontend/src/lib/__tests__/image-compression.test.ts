/**
 * Tests for image compression logic.
 * TOTEST §2
 *
 * We test the exported `compressImageForUpload` function by mocking
 * `Worker` (unavailable in jsdom) so that the fallback main-thread path
 * is used — which in turn relies on canvas / createImageBitmap stubs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock Worker globally *before* importing the module
vi.stubGlobal("Worker", undefined);

// Dynamic import so that the module sees our stubs
const { compressImageForUpload } = await import("../image-compression");

function makeFile(name: string, type: string, sizeKB: number): File {
  const bytes = new Uint8Array(sizeKB * 1024);
  return new File([bytes], name, { type });
}

describe("compressImageForUpload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same file when smaller than 300 KB", async () => {
    const small = makeFile("photo.jpg", "image/jpeg", 100);
    const result = await compressImageForUpload(small);
    expect(result).toBe(small);
  });

  it("returns the same file for GIF", async () => {
    const gif = makeFile("anim.gif", "image/gif", 500);
    const result = await compressImageForUpload(gif);
    expect(result).toBe(gif);
  });

  it("returns the same file for SVG", async () => {
    const svg = makeFile("icon.svg", "image/svg+xml", 500);
    const result = await compressImageForUpload(svg);
    expect(result).toBe(svg);
  });

  it("returns the same file for non-image", async () => {
    const pdf = makeFile("doc.pdf", "application/pdf", 500);
    const result = await compressImageForUpload(pdf);
    expect(result).toBe(pdf);
  });

  it("resizes image 4000x3000 to max 1920px on longest side", async () => {
    const large = makeFile("big.jpg", "image/jpeg", 500);

    // Mock createImageBitmap: image is 4000×3000
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    // Mock canvas — capture the assigned width/height
    const smallBlob = new Blob([new Uint8Array(200 * 1024)], { type: "image/webp" });
    const mockCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvasObj = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(smallBlob)),
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvasObj as unknown as HTMLElement);

    const result = await compressImageForUpload(large);

    // The canvas dimensions should be scaled down to fit 1920 max
    // 4000×3000 → scale = min(1920/4000, 1920/3000, 1) = 0.48
    // Width = round(4000 * 0.48) = 1920, Height = round(3000 * 0.48) = 1440
    expect(canvasObj.width).toBeLessThanOrEqual(1920);
    expect(canvasObj.height).toBeLessThanOrEqual(1920);
    expect(canvasObj.width).toBeGreaterThan(0);
    expect(canvasObj.height).toBeGreaterThan(0);
    // The longer side should be exactly 1920
    const longerSide = Math.max(canvasObj.width, canvasObj.height);
    expect(longerSide).toBe(1920);
    expect(result.type).toBe("image/webp");
  });

  it("attempts compression for large JPEG and returns file", async () => {
    const large = makeFile("big.jpg", "image/jpeg", 500);

    // Mock createImageBitmap
    const bitmap = { width: 3000, height: 2000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    // Mock canvas.toBlob to produce a smaller blob
    const smallBlob = new Blob([new Uint8Array(200 * 1024)], { type: "image/webp" });
    const mockCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(smallBlob)),
    };
    vi.spyOn(document, "createElement").mockReturnValue(mockCanvas as unknown as HTMLElement);

    const result = await compressImageForUpload(large);
    // Compressed file should be WebP
    expect(result.type).toBe("image/webp");
    expect(result.name).toContain(".webp");
    expect(result.size).toBeLessThan(large.size);
  });
});
