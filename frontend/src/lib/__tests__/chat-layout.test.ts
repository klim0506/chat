import { describe, expect, it } from "vitest";
import type { Message, User } from "../../api/client";
import { getChatMessageLayoutMeta } from "../chat-layout";

const baseUser = (id: string): User => ({
  id,
  phone: `+100000000${id}`,
  display_name: `User ${id}`,
  avatar: null,
  avatar_url: null,
});

function makeMessage(id: string, senderId: string, createdAt: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    chat: "chat-1",
    sender: baseUser(senderId),
    msg_type: "text",
    content: id,
    file: null,
    files: [],
    created_at: createdAt,
    edited_at: null,
    is_deleted: false,
    reactions: {},
    my_reactions: [],
    ...extra,
  };
}

describe("chat layout grouping", () => {
  it("keeps messages from one sender visually close but not merged", () => {
    const messages = [
      makeMessage("m1", "u1", "2026-03-19T10:00:00.000Z"),
      makeMessage("m2", "u1", "2026-03-19T10:01:00.000Z"),
      makeMessage("m3", "u1", "2026-03-19T10:02:00.000Z"),
    ];

    expect(getChatMessageLayoutMeta(messages, 0)).toMatchObject({
      isFirstInGroup: true,
      showAvatar: false,
      rowGapPx: 0,
      sentinelHeight: 0,
    });
    expect(getChatMessageLayoutMeta(messages, 1)).toMatchObject({
      isFirstInGroup: false,
      showAvatar: false,
      rowGapPx: 3,
      sentinelHeight: 0,
    });
    expect(getChatMessageLayoutMeta(messages, 2)).toMatchObject({
      isFirstInGroup: false,
      showAvatar: true,
      rowGapPx: 3,
      sentinelHeight: 4,
    });
  });

  it("adds a larger gap between groups regardless of sender side", () => {
    const messages = [
      makeMessage("m1", "u1", "2026-03-19T10:00:00.000Z"),
      makeMessage("m2", "u2", "2026-03-19T10:01:00.000Z"),
      makeMessage("m3", "u2", "2026-03-19T10:02:00.000Z"),
    ];

    expect(getChatMessageLayoutMeta(messages, 1)).toMatchObject({
      isFirstInGroup: true,
      rowGapPx: 5,
    });
    expect(getChatMessageLayoutMeta(messages, 2)).toMatchObject({
      isFirstInGroup: false,
      rowGapPx: 3,
    });
  });

  it("starts a new group after a long time gap and shows a date divider on a new day", () => {
    const messages = [
      makeMessage("m1", "u1", "2026-03-18T18:58:00.000Z"),
      makeMessage("m2", "u1", "2026-03-19T08:08:00.000Z"),
    ];

    expect(getChatMessageLayoutMeta(messages, 1)).toMatchObject({
      isFirstInGroup: true,
      showDateDivider: true,
      rowGapPx: 2,
    });
  });

  it("treats imported sender display names as separate grouping identities", () => {
    const messages = [
      makeMessage("m1", "u1", "2026-03-19T10:00:00.000Z", { sender_display_name: "Imported A" }),
      makeMessage("m2", "u1", "2026-03-19T10:01:00.000Z", { sender_display_name: "Imported B" }),
    ];

    expect(getChatMessageLayoutMeta(messages, 1)).toMatchObject({
      isFirstInGroup: true,
      showAvatar: true,
      rowGapPx: 5,
    });
  });
});
