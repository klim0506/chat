import { describe, expect, it } from "vitest";
import type { Message } from "../../api/client";
import { buildSearchSnippet, rankSecretChatMessages, scoreSearchableConversation } from "../search";

function makeMessage(id: string, content: string, createdAt: string): Message {
  return {
    id,
    chat: "chat-1",
    sender: {
      id: "u1",
      phone: "+1000000000",
      display_name: "User",
      avatar: null,
      avatar_url: null,
    },
    msg_type: "text",
    content,
    file: null,
    files: [],
    created_at: createdAt,
    edited_at: null,
    is_deleted: false,
    reactions: {},
    my_reactions: [],
  };
}

describe("search helpers", () => {
  it("prefers prefix matches over generic includes", () => {
    const prefix = scoreSearchableConversation("ann", { title: "Anna Smith" });
    const include = scoreSearchableConversation("ann", { title: "Joann Doe" });
    expect(prefix).toBeGreaterThan(include);
  });

  it("ranks secret messages by relevance and recency", () => {
    const messages = [
      makeMessage("m1", "hello project team", "2026-03-19T08:00:00.000Z"),
      makeMessage("m2", "team sync project update", "2026-03-19T09:00:00.000Z"),
      makeMessage("m3", "random note", "2026-03-19T10:00:00.000Z"),
    ];

    expect(rankSecretChatMessages(messages, "project team").map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("builds compact snippets around the match", () => {
    const snippet = buildSearchSnippet("one two three four target five six seven eight", "target", 8);
    expect(snippet).toContain("target");
    expect(snippet.startsWith("...")).toBe(true);
  });
});
