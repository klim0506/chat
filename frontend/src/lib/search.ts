import type { Chat, Channel, GlobalSearchResult, Message } from "../api/client";

type SearchableConversation = {
  title: string;
  username?: string | null;
  secondary?: string | null;
  sortTs?: number;
};

export function normalizeSearchText(value: string | null | undefined): string {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSearchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(" ").filter(Boolean)));
}

export function scoreSearchableConversation(query: string, item: SearchableConversation): number {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);
  if (!normalizedQuery || tokens.length === 0) return 0;

  const title = normalizeSearchText(item.title);
  const username = normalizeSearchText(item.username);
  const secondary = normalizeSearchText(item.secondary);
  const haystack = [title, username, secondary].filter(Boolean).join(" ");
  if (!haystack) return 0;

  let score = 0;
  if (title === normalizedQuery) score += 120;
  else if (title.startsWith(normalizedQuery)) score += 80;
  else if (title.includes(normalizedQuery)) score += 48;

  if (username) {
    if (username === normalizedQuery) score += 110;
    else if (username.startsWith(normalizedQuery)) score += 72;
    else if (username.includes(normalizedQuery)) score += 40;
  }

  if (secondary) {
    if (secondary.startsWith(normalizedQuery)) score += 34;
    else if (secondary.includes(normalizedQuery)) score += 18;
  }

  for (const token of tokens) {
    if (title.startsWith(token)) score += 22;
    else if (title.includes(token)) score += 10;

    if (username.startsWith(token)) score += 18;
    else if (username.includes(token)) score += 8;

    if (secondary.includes(token)) score += 6;
  }

  if (score <= 0) return 0;
  const freshnessBoost = item.sortTs ? Math.min(14, Math.round(item.sortTs / 86_400_000_000)) : 0;
  return score + freshnessBoost;
}

export function scoreMessageMatch(query: string, content: string | null | undefined): number {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);
  const text = normalizeSearchText(content);
  if (!normalizedQuery || !text) return 0;

  let score = 0;
  if (text.includes(normalizedQuery)) score += 60;
  for (const token of tokens) {
    if (text.includes(token)) score += 16;
  }
  return score;
}

export function rankSecretChatMessages(messages: Message[], query: string): Message[] {
  return messages
    .filter((message) => !message.is_deleted)
    .map((message) => ({ message, score: scoreMessageMatch(query, message.content) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.message.created_at).getTime() - new Date(a.message.created_at).getTime();
    })
    .map((entry) => entry.message);
}

export function buildSearchSnippet(content: string | null | undefined, query: string, radius = 44): string {
  const raw = String(content || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return raw.length > radius * 2 ? `${raw.slice(0, radius * 2).trim()}...` : raw;

  const lowerRaw = raw.toLocaleLowerCase();
  const lowerNeedle = String(query || "").trim().toLocaleLowerCase();
  const index = lowerNeedle ? lowerRaw.indexOf(lowerNeedle) : -1;
  if (index < 0) return raw.length > radius * 2 ? `${raw.slice(0, radius * 2).trim()}...` : raw;

  const start = Math.max(0, index - radius);
  const end = Math.min(raw.length, index + lowerNeedle.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < raw.length ? "..." : "";
  return `${prefix}${raw.slice(start, end).trim()}${suffix}`;
}

export function scoreGlobalSearchResult(query: string, result: GlobalSearchResult): number {
  return (
    scoreMessageMatch(query, result.content) +
    scoreSearchableConversation(query, {
      title: result.chat_title,
      secondary: result.sender_name,
    })
  );
}

export function scoreChatForSearch(query: string, chat: Chat, sortTs: number): number {
  return scoreSearchableConversation(query, {
    title: chat.is_favorites ? "favorites" : (chat.is_personal && chat.other_member ? chat.other_member.display_name || chat.other_member.username || chat.other_member.phone || "" : chat.title || ""),
    username: chat.is_personal ? chat.other_member?.username : null,
    secondary: chat.title || chat.last_message_preview || "",
    sortTs,
  });
}

export function scoreChannelForSearch(query: string, channel: Channel, sortTs: number): number {
  return scoreSearchableConversation(query, {
    title: channel.title || "",
    username: channel.username || "",
    secondary: "",
    sortTs,
  });
}
