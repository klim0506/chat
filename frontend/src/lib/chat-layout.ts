import type { Message, User } from "../api/client";

export const CHAT_GROUP_TIME_MS = 5 * 60 * 1000;
export const CHAT_MESSAGE_ITEM_GAP_CLASS = "mt-1.5";
export const CHAT_MESSAGE_GROUP_GAP_CLASS = "mt-3";
export const CHAT_MESSAGE_FIRST_ITEM_GAP_CLASS = "mt-0";
export const CHAT_MESSAGE_AFTER_DATE_GAP_CLASS = "mt-1.5";
export const CHAT_GROUP_SENTINEL_HEIGHT = 4;

function getSenderId(msg: Message): string {
  if ((msg as { sender_id?: string }).sender_id) return (msg as { sender_id?: string }).sender_id ?? "";
  if (msg.sender && typeof msg.sender === "object" && "id" in msg.sender) return (msg.sender as User).id;
  return "";
}

export function getSenderKey(msg: Message): string {
  const displayName = (msg as { sender_display_name?: string }).sender_display_name;
  if (displayName) return `dn:${displayName}`;
  return getSenderId(msg) || "?";
}

export function isSameDay(isoA: string | undefined, isoB: string | undefined): boolean {
  if (!isoA || !isoB) return false;
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getTimeMs(iso: string | undefined): number {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : 0;
}

export type ChatMessageLayoutMeta = {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showAvatar: boolean;
  showDateDivider: boolean;
  rowGapClass: string;
  sentinelHeight: number;
};

export function getChatMessageLayoutMeta(messages: Message[], index: number): ChatMessageLayoutMeta {
  const message = messages[index];
  const prevMsg = index > 0 ? messages[index - 1] : undefined;
  const nextMsg = index < messages.length - 1 ? messages[index + 1] : undefined;

  const currentSender = getSenderKey(message);
  const prevSender = prevMsg ? getSenderKey(prevMsg) : null;
  const nextSender = nextMsg ? getSenderKey(nextMsg) : null;
  const prevGap = prevMsg ? getTimeMs(message.created_at) - getTimeMs(prevMsg.created_at) : Infinity;
  const nextGap = nextMsg ? getTimeMs(nextMsg.created_at) - getTimeMs(message.created_at) : Infinity;

  const isFirstInGroup = !prevMsg || prevSender !== currentSender || prevGap >= CHAT_GROUP_TIME_MS;
  const showAvatar = !nextMsg || nextSender !== currentSender || nextGap >= CHAT_GROUP_TIME_MS;
  const isLastInGroup = showAvatar && !!prevMsg && prevSender === currentSender;
  const showDateDivider = !prevMsg || !isSameDay(prevMsg.created_at, message.created_at);

  let rowGapClass = CHAT_MESSAGE_ITEM_GAP_CLASS;
  if (index === 0) rowGapClass = CHAT_MESSAGE_FIRST_ITEM_GAP_CLASS;
  else if (showDateDivider) rowGapClass = CHAT_MESSAGE_AFTER_DATE_GAP_CLASS;
  else if (isFirstInGroup) rowGapClass = CHAT_MESSAGE_GROUP_GAP_CLASS;

  return {
    isFirstInGroup,
    isLastInGroup,
    showAvatar,
    showDateDivider,
    rowGapClass,
    sentinelHeight: showAvatar ? CHAT_GROUP_SENTINEL_HEIGHT : 0,
  };
}
