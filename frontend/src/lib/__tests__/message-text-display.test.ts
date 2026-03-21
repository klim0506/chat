import { describe, it, expect } from "vitest";
import { stripTrailingNewlinesForDisplay } from "../message-text-display";

describe("stripTrailingNewlinesForDisplay", () => {
  it("removes trailing newlines only", () => {
    expect(stripTrailingNewlinesForDisplay("a\nb\n")).toBe("a\nb");
    expect(stripTrailingNewlinesForDisplay("a\nb\n\n")).toBe("a\nb");
    expect(stripTrailingNewlinesForDisplay("hello")).toBe("hello");
  });

  it("keeps internal blank lines", () => {
    expect(stripTrailingNewlinesForDisplay("a\n\nb")).toBe("a\n\nb");
  });
});
