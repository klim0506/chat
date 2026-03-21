import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, memo, Fragment } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { chatsApi, messagesApi, filesApi, scheduledApi, authApi, contactsApi, channelsApi, channelPostsApi, channelPostCommentsApi, stickersApi, paymentsApi, userDisplayName, normalizeMediaPayload } from "../api/client";
import type { Chat, ChatMember, Channel, ChannelPost, ChannelPostComment, Message, ReplyMessage, User, UserSearchResult, ScheduledMessage as ScheduledMessageType, Contact } from "../api/client";
import { useAuthStore } from "../store/auth";
import { buildSearchSnippet, rankSecretChatMessages } from "../lib/search";
import { usePremiumModalStore } from "../store/premiumModal";
import { usePreferencesStore } from "../store/preferences";
import { useMessagesStore, normalizeMessage as storeNormalizeMessage } from "../store/messages";
import { useUploadProgressStore } from "../store/uploadProgress";
import { useOutboxStore } from "../store/outbox";
import { useNetworkStore } from "../store/network";
import { useChatListStore } from "../store/chatList";
import { getAvatarInitials } from "../lib/avatar-initials";
// import { compressImageForUpload } from "../lib/image-compression";
import { playSound } from "../lib/sounds";
import { AvatarEditorModal } from "../components/AvatarEditorModal";
import { AvatarCropConfirmModal } from "../components/AvatarCropConfirmModal";
import { FilePreviewModal } from "../components/FilePreviewModal";
import CreatePollModal from "../components/CreatePollModal";
import { OfflineBanner } from "../components/OfflineBanner";
import { ProgressiveImage } from "../components/ProgressiveImage";
import { MediaImage } from "../components/MediaImage";
import { WsManager, buildWsUrl } from "../lib/ws-manager";
import { broadcastMessageCreated } from "../lib/cross-tab-sync";
import { db } from "../lib/db";
import { prepareEncryptedMessage } from "../lib/e2ee/prepare-message";
import { decryptFromDevice } from "../lib/e2ee/session-manager";
import * as e2eeKeyStorage from "../lib/e2ee/key-storage";
import { useCachedMediaUrl } from "../hooks/useCachedMediaUrl";
import { toSameOriginMediaUrl, getAvatarUrlBySize } from "../lib/media-url";
import { isStandalone } from "../lib/pwa";
import { AnimatedReaction } from "../components/AnimatedReaction";
import { MessageListSkeleton } from "../components/MessageListSkeleton";
import { LottieSticker, getStickerAnimationUrl } from "../components/LottieSticker";
import { StickerGifPanel } from "../components/StickerGifPanel";
import ConfirmModal from "../components/ConfirmModal";
import { ModalViewportLayer } from "../components/TopLayerPortal";
import ImportTelegramModal from "../components/ImportTelegramModal";
import ImportTelegramChatModal from "../components/ImportTelegramChatModal";
import ManageImportModal from "../components/ManageImportModal";
import { StickerPackManagerModal } from "../components/StickerPackManagerModal";
import SendIcon from "../components/icons/SendIcon";
import { REACTIONS } from "../lib/reaction-animations";
import { switchLayout } from "../lib/layout-switcher";
import { filterEmojiByPrefix } from "../data/emoji-shortcodes";
import { useTranslation, formatLastSeenI18n, formatDateLabelI18n, formatMembersCount, getLocale, getWeekdays, t as tI18n } from "../lib/i18n";
import { getChatMessageLayoutMeta } from "../lib/chat-layout";
import { buildUserInfoHref } from "../lib/user-info-link";
import { useMediaAccess } from "../hooks/useMediaAccess";
import { resolveMediaAccess } from "../lib/media-access";
import { stripTrailingNewlinesForDisplay } from "../lib/message-text-display";
/* Default chat background: vector gradient (no image request) or custom background_url */

/** Reaction emojis (from reaction-animations, matches backend) */
const REACTION_EMOJIS = REACTIONS.map((r) => r.emoji);

/** Maximum file upload size — 2 GB */
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
/** Maximum message content length (chars) — backend enforces the same */
const MESSAGE_MAX_LENGTH = 4096;
const VIRTUALIZATION_THRESHOLD = 120;
const VIRTUAL_ROW_ESTIMATE = 92;
const VIRTUAL_OVERSCAN = 10;
const CHANNEL_COMMENTS_PAGE_SIZE = 200;

type VoiceInfoKind = "voice" | "circle";
type VoiceInfoItem = { kind: VoiceInfoKind; msg: Message };

function VoiceInfoList({
  items,
  locale,
  voiceLabel,
  circleLabel,
  onJump,
}: {
  items: VoiceInfoItem[];
  locale: string;
  voiceLabel: string;
  circleLabel: string;
  onJump: (messageId: string) => void;
}) {
  const [durations, setDurations] = useState<Record<string, number>>({});

  const resolveUrl = useCallback(async (msg: Message) => {
    const raw =
      msg.file && typeof msg.file === "object" && "url" in msg.file
        ? ((msg.file as { url?: string | null }).url || "")
        : "";
    const accessible = await resolveMediaAccess(raw);
    return toSameOriginMediaUrl(accessible) || accessible;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pending: HTMLMediaElement[] = [];

    items.forEach(({ kind, msg }) => {
      if (!msg?.id) return;
      if (durations[msg.id] != null) return;
      resolveUrl(msg)
        .then((url) => {
          if (cancelled || !url) return;
          const el = kind === "circle" ? document.createElement("video") : new Audio();
          el.preload = "metadata";
          el.src = url;
          pending.push(el);

          const onLoaded = () => {
            if (cancelled) return;
            const d = Number(el.duration);
            setDurations((prev) => (prev[msg.id] != null ? prev : { ...prev, [msg.id]: Number.isFinite(d) && d > 0 ? d : 0 }));
          };
          const onError = () => {
            if (cancelled) return;
            setDurations((prev) => (prev[msg.id] != null ? prev : { ...prev, [msg.id]: 0 }));
          };

          el.addEventListener("loadedmetadata", onLoaded);
          el.addEventListener("error", onError);

          (el as unknown as { __voiceCleanup?: () => void }).__voiceCleanup = () => {
            el.removeEventListener("loadedmetadata", onLoaded);
            el.removeEventListener("error", onError);
            try { el.src = ""; el.load(); } catch { /* ignore */ }
          };
        })
        .catch(() => {
          if (!cancelled) setDurations((prev) => (prev[msg.id] != null ? prev : { ...prev, [msg.id]: 0 }));
        });
    });

    return () => {
      cancelled = true;
      pending.forEach((el) => {
        const cleanup = (el as unknown as { __voiceCleanup?: () => void }).__voiceCleanup;
        cleanup?.();
      });
    };
  }, [items, durations, resolveUrl]);

  return (
    <ul className="space-y-1">
      {items.map(({ kind, msg }) => {
        const d = msg.created_at ? new Date(msg.created_at) : null;
        const dateStr = d ? d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }) : "";
        const timeStr = d ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
        const dur = durations[msg.id];
        const durStr = dur != null ? formatAudioTime(dur) : "…";
        return (
          <li key={msg.id}>
            <button
              type="button"
              onClick={() => onJump(msg.id)}
              className="w-full text-left text-sm text-slate-700 hover:bg-slate-50 px-2 py-1.5 rounded flex items-center gap-2"
            >
              {kind === "voice" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="12" cy="12" r="7"/>
                  <polygon points="11 10 16 12 11 14 11 10"/>
                </svg>
              )}
              <span className="truncate flex-1 min-w-0">{kind === "voice" ? voiceLabel : circleLabel}</span>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                {dateStr} {timeStr}{durStr ? ` · ${durStr}` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}


type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type BrowserSpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionCtor = new () => BrowserSpeechRecognitionLike;

/* ================================================================
   Helpers
   ================================================================ */

/** Format date for dividers: "Today", "Yesterday", or "February 15 [2025]" */
function formatDateLabel(iso: string | undefined, lang: "en" | "ru"): string {
  return formatDateLabelI18n(iso, lang);
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* */ }
  document.body.removeChild(ta);
  return Promise.resolve();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compress image to save memory (attachment / bottom zone). Currently disabled — stored at full size. */
async function compressImage(file: File): Promise<File> {
  // return compressImageForUpload(file, { maxDim: 2560, quality: 0.92 });
  return file;
}

/** Strip Markdown formatting for pasting into Word etc.: bold, italic, links [text](url)→text, code `...`, headings #. */
function stripMarkdown(text: string): string {
  let s = text;
  // Links [text](url) → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Inline code `...`
  s = s.replace(/`([^`]*)`/g, "$1");
  // Bold **...** or __...__
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  // Italic *...* or _..._ (not mid-word)
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");
  // Strikethrough ~~...~~
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // Headings at line start: # ## ### ...
  s = s.replace(/^#{1,6}\s+/gm, "");
  return s.trim();
}

/** Format "last seen" display */
function formatLastSeen(value: string | null | undefined, lang: "en" | "ru"): string {
  return formatLastSeenI18n(value, lang);
}

function getSenderId(msg: Message): string {
  if ((msg as { sender_id?: string }).sender_id) return (msg as { sender_id?: string }).sender_id!;
  if (msg.sender && typeof msg.sender === "object" && "id" in msg.sender) return (msg.sender as User).id;
  return "";
}

function getSenderName(msg: Message): string {
  return (
    (msg as { sender_display_name?: string }).sender_display_name ||
    ((msg.sender as User) ? userDisplayName(msg.sender as User) : null) ||
    (msg.sender as User)?.phone ||
    (msg.sender as User)?.phone ||
    (msg as { sender_id?: string }).sender_id ||
    "?"
  );
}

/** Regex for mentions: @Name or @First Last (up to whitespace/end/next @) */
const MENTION_REGEX = /(@(?:[^\s@]+(?:\s+[^\s@]+)*?))(?=\s|$|@)/g;

/** Convert Markdown subset (** * ~~ [](url) [](copy)) to HTML for WYSIWYG input field */
function markdownToHtml(md: string): string {
  if (!md.trim()) return "";
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // [text](copy) or [text](copy:...) — copyable on click
  html = html.replace(/\[([^\]]*)\]\((copy(?::[^)]*)?)\)/g, '<span data-copy="true">$1</span>');
  // [text](url) — link
  html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, "&quot;")}">${t}</a>`);
  // **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic*
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  // ~~strike~~
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\n/g, "<br>");
  return html;
}

/** Block elements that create paragraphs in contenteditable */
const BLOCK_TAGS = new Set(["DIV", "P"]);

/** Convert HTML from contenteditable back to Markdown for sending */
function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\u00A0/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    const children = Array.from(node.childNodes);
    const parts = children.map(walk);
    if (tag === "BR") return "\n";
    if (tag === "STRONG" || tag === "B") return `**${parts.join("")}**`;
    if (tag === "EM" || tag === "I") return `*${parts.join("")}*`;
    if (tag === "S" || tag === "STRIKE") return `~~${parts.join("")}~~`;
    if (tag === "A") {
      const href = (el.getAttribute("href") || "").trim();
      const inner = parts.join("");
      if (href === "copy" || href.startsWith("copy:")) return `[${inner}](copy)`;
      return `[${inner}](${href})`;
    }
    if (tag === "SPAN" && el.getAttribute("data-copy") === "true") return `[${parts.join("")}](copy)`;
    // Preserve empty lines: block children (DIV, P) need \n\n between; empty block = blank line
    if ((tag === "DIV" || tag === "P") && children.some((c) => c.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((c as HTMLElement).tagName))) {
      let result = "";
      for (const p of parts) {
        const trimmed = (p ?? "").trim();
        if (!trimmed) result += "\n\n";
        else {
          if (result && !result.endsWith("\n")) result += "\n\n";
          result += p;
        }
      }
      return result;
    }
    return parts.join("");
  }
  return walk(div).replace(/\n/g, "\n").trim();
}

/** Current cursor position (in characters) in a contenteditable element */
function getEditableCursorOffset(editable: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(editable, 0);
  return range.toString().length;
}

/** Set cursor in a contenteditable element to the given character offset */
function setEditableCursorOffset(editable: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let passed = 0;
  function walk(n: Node): boolean {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent || "").length;
      if (passed + len >= offset) {
        range.setStart(n, Math.min(offset - passed, len));
        range.collapse(true);
        return true;
      }
      passed += len;
      return false;
    }
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === "BR") {
      if (passed + 1 >= offset) {
        range.setStartBefore(n);
        range.collapse(true);
        return true;
      }
      passed += 1;
      return false;
    }
    for (let i = 0; i < n.childNodes.length; i++) {
      if (walk(n.childNodes[i])) return true;
    }
    return false;
  }
  if (!walk(editable)) {
    range.selectNodeContents(editable);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function lowerBound(values: number[], target: number): number {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (values[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left;
}

/** Get a Range by character offsets in a contenteditable element */
function getEditableRangeByOffsets(editable: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let passed = 0;
  let startSet = false;
  function walk(n: Node): boolean {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent || "").length;
      if (!startSet && passed + len >= start) {
        range.setStart(n, Math.min(start - passed, len));
        startSet = true;
      }
      if (startSet && passed + len >= end) {
        range.setEnd(n, Math.min(end - passed, len));
        return true;
      }
      passed += len;
      return false;
    }
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === "BR") {
      if (!startSet && passed + 1 >= start) {
        range.setStartBefore(n);
        startSet = true;
      }
      if (startSet && passed + 1 >= end) {
        range.setEndAfter(n);
        return true;
      }
      passed += 1;
      return false;
    }
    for (let i = 0; i < n.childNodes.length; i++) {
      if (walk(n.childNodes[i])) return true;
    }
    return false;
  }
  if (!walk(editable)) return null;
  return range;
}

/** Split text into segments: plain text and @-mentions */
function splitContentWithMentions(content: string): { type: "text" | "mention"; value: string }[] {
  const segments: { type: "text" | "mention"; value: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  MENTION_REGEX.lastIndex = 0;
  while ((m = MENTION_REGEX.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, m.index) });
    }
    segments.push({ type: "mention", value: m[1] });
    lastIndex = m.index + m[1].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

/**
 * Create touch event handlers for long-press on mobile devices.
 * callback fires after holding ≥ delay ms without moving the finger.
 * firedRef.current will be true if the long-press fired (allows suppressing onClick).
 */
function makeLongPressHandlers(
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  firedRef: React.MutableRefObject<boolean>,
  callback: (e: React.TouchEvent) => void,
  delay = 500,
) {
  const startRef: { x: number; y: number }[] = [];
  return {
    onTouchStart(e: React.TouchEvent) {
      if (e.touches.length !== 1) return;
      firedRef.current = false;
      const touch = e.touches[0];
      startRef[0] = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        if (navigator.vibrate) navigator.vibrate(15);
        callback(e);
      }, delay);
    },
    onTouchMove(e: React.TouchEvent) {
      if (!timerRef.current || e.touches.length !== 1) return;
      const start = startRef[0];
      if (!start) return;
      const dx = Math.abs(e.touches[0].clientX - start.x);
      const dy = Math.abs(e.touches[0].clientY - start.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    onTouchEnd() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    },
    onTouchCancel() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    },
  };
}

/** Link preview card — accent bar, title + description, square thumb (below message text) */
function LinkPreviewCard({
  preview,
  isMine,
  className = "",
}: {
  preview: { url: string; title?: string; description?: string; image?: string };
  isMine: boolean;
  className?: string;
}) {
  const barCls = isMine ? "bg-emerald-500" : "bg-blue-500";
  const titleCls = isMine ? "text-emerald-700 font-semibold" : "text-blue-700 font-semibold";

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block mt-2 rounded-lg overflow-hidden hover:opacity-90 transition-opacity max-w-[280px] sm:max-w-[320px] ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <div className={`w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem] ${barCls}`} />
        <div className="flex-1 min-w-0">
          {preview.title && <p className={`ui-text-body line-clamp-1 ${titleCls}`}>{preview.title}</p>}
          {preview.description && <p className="ui-text-assist text-slate-600 line-clamp-2 mt-0.5">{preview.description}</p>}
        </div>
        {preview.image && (
          <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-slate-200">
            <ProgressiveImage
              src={preview.image}
              alt=""
              className="w-full h-full"
              objectFit="cover"
              fill
              fullWidth={160}
            />
          </div>
        )}
      </div>
    </a>
  );
}

/** Render message text with Markdown support and @-mentions */
function MarkdownMessageContent({
  content,
  isMine,
  className = "",
  inline = false,
  linkPreview = null,
}: {
  content: string;
  isMine: boolean;
  className?: string;
  inline?: boolean;
  linkPreview?: { url: string; title?: string; description?: string; image?: string } | null;
}) {
  const baseCls = "ui-text-body text-slate-800";
  const navigate = useNavigate();
  /** Drop trailing empty lines; keep internal Shift+Enter breaks (remark-breaks). */
  const segments = splitContentWithMentions(stripTrailingNewlinesForDisplay(content));
  const Wrapper: React.ElementType = inline ? "span" : "div";
  const handleMentionClick = useCallback(async (raw: string) => {
    const username = raw.replace(/^@+/, "").trim();
    if (!username) return;
    try {
      await authApi.resolveUsername(username);
      navigate(`/u/${encodeURIComponent(username)}`);
      return;
    } catch {
      // not a user or not found — try channel
    }
    try {
      const { data } = await channelsApi.resolveUsername(username);
      if (data?.id) navigate(`/channel/${data.id}`);
    } catch {
      // ignore
    }
  }, [navigate]);
  return (
    <Wrapper className={`markdown-message ${baseCls} ${className}`}>
      {segments.map((seg, i) => {
        if (seg.type === "mention") {
          const username = seg.value.slice(1).trim();
          return (
            <Link
              key={i}
              to={`/u/${encodeURIComponent(username)}`}
              onClick={(e) => { e.preventDefault(); handleMentionClick(seg.value); }}
              className={`inline font-medium underline decoration-dotted ${isMine ? "text-blue-700 hover:text-blue-800" : "text-blue-600 hover:text-blue-700"}`}
              title={username}
            >
              {seg.value}
            </Link>
          );
        }
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={{
              p: ({ children }) => (inline ? <span className="inline">{children}</span> : <span className="block">{children}</span>),
              strong: ({ children }) => <strong className="font-bold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              s: ({ children }) => <s className="line-through">{children}</s>,
              a: ({ href, children, ...props }) => {
                const isCopy = href === "copy" || (href?.startsWith("copy:") ?? false);
                if (isCopy) {
                  return (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => copyToClipboard((e.currentTarget as HTMLElement).textContent || "").then(() => {})}
                      onKeyDown={(e) => { if (e.key === "Enter") copyToClipboard((e.currentTarget as HTMLElement).textContent || ""); }}
                      className="underline cursor-pointer decoration-dotted hover:opacity-80"
                    >
                      {children}
                    </span>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline" {...props}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {seg.value}
          </ReactMarkdown>
        );
      })}
      {!inline && linkPreview?.url && (
        <LinkPreviewCard preview={linkPreview} isMine={isMine} />
      )}
    </Wrapper>
  );
}

const MemoMarkdownMessageContent = memo(MarkdownMessageContent);

const MemoImageTileGrid = memo(
  function MemoImageTileGrid({
    images,
    imagesKey,
  }: {
    images: { id: string; url?: string | null; original_name?: string; mime_type?: string }[];
    imagesKey: string;
  }) {
    return <ImageTileGrid key={imagesKey} images={images} />;
  },
  (prev, next) => prev.imagesKey === next.imagesKey,
);

/** Normalize API/WS message shape (reactions, read status, etc.). */
function normalizeMessage(msg: Message & { read_status?: "delivered" | "read" | null; my_reaction?: string | null }): Message {
  let files = msg.files ?? [];
  if (!Array.isArray(files)) files = [];
  if (files.length === 0 && msg.file) files = [msg.file];
  // Keep only objects with id (API may return raw ids or incomplete data)
  const safeFiles = files.filter((f) => f != null && typeof f === "object" && "id" in f) as Message["files"];
  const file = msg.file != null && typeof msg.file === "object" && "id" in msg.file ? msg.file : (safeFiles[0] ?? null);
  const myReactions = msg.my_reactions ?? (msg.my_reaction ? [msg.my_reaction] : []);
  const readBy = (msg as Message & { read_by?: User[] }).read_by;
  return {
    ...msg,
    file: file as Message["file"],
    files: safeFiles as Message["files"],
    reactions: msg.reactions ?? {},
    my_reactions: Array.isArray(myReactions) ? myReactions : [],
    read_status: msg.read_status ?? undefined,
    read_by: Array.isArray(readBy) ? readBy : undefined,
  };
}

/* ================================================================
   ChatPage
   ================================================================ */

/** Message preview for the chat list (matches backend logic). */
function formatMessagePreview(msg: { msg_type?: string; content?: string; file?: { mime_type?: string } | null }, lang?: "en" | "ru"): string {
  if (!msg) return "";
  const mime = (msg.file && msg.file.mime_type) || "";
  if (lang !== undefined) {
    if (msg.msg_type === "audio") return tI18n("common.voice", lang);
    if (msg.msg_type === "video" || msg.msg_type === "video_circle" || String(mime).startsWith("video/")) return tI18n("common.video", lang);
    if (String(mime).startsWith("image/")) return tI18n("common.photo", lang);
    if (msg.msg_type === "file") return tI18n("common.fileMsg", lang);
    if (msg.msg_type === "gif") return "(GIF)";
    if (msg.msg_type === "sticker") return tI18n("common.stickerMsg", lang);
    if (msg.msg_type === "poll") return tI18n("chat.poll", lang);
    const text = (msg.content || "").trim();
    if (!text) return tI18n("common.message", lang);
    return text.length > 60 ? text.slice(0, 60) + "…" : text;
  }
  if (msg.msg_type === "audio") return "(голосовое)";
  if (msg.msg_type === "video" || msg.msg_type === "video_circle" || String(mime).startsWith("video/")) return "(видео)";
  if (String(mime).startsWith("image/")) return "(фото)";
  if (msg.msg_type === "file") return "(файл)";
  if (msg.msg_type === "gif") return "(GIF)";
  if (msg.msg_type === "sticker") return "(стикер)";
  if (msg.msg_type === "poll") return "(опрос)";
  const text = (msg.content || "").trim();
  if (!text) return "(сообщение)";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

/** Inline video in a message: no autoplay. Shows the first frame; playback on click (opens lightbox or in-component controls). */
function InlineAutoplayVideo({
  src,
  className = "",
}: {
  src: string;
  className?: string;
  controls?: boolean;
}) {
  const resolvedUrl = useMediaAccess(src || null, { enabled: !!src });
  const videoUrl = resolvedUrl ? (toSameOriginMediaUrl(resolvedUrl) || resolvedUrl) : "";
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        className={className}
        preload="metadata"
        playsInline
      />
    </div>
  );
}

function normalizeInviteLink(link: string): string {
  if (!link) return link;
  try {
    const u = new URL(link, window.location.origin);
    if (u.pathname.startsWith("/chat/join/")) {
      return `${window.location.origin}${u.pathname}${u.search}`;
    }
    return link;
  } catch {
    return link;
  }
}

/** Channel as User-like sender — messages in channel are shown from the channel, not the author. */
function channelAsSender(ch: Channel): User {
  return {
    id: ch.id,
    phone: "",
    display_name: ch.title,
    avatar: null,
    avatar_url: ch.avatar_url ?? null,
    username: ch.username ?? undefined,
  };
}

function channelPostToMessage(post: ChannelPost, chId: string, channel: Channel | null): Message & { authorId?: string } {
  return {
    id: post.id,
    chat: chId,
    sender: channel ? channelAsSender(channel) : post.author,
    authorId: post.author?.id,
    msg_type: post.msg_type,
    content: post.content,
    file: post.file,
    files: post.files ?? [],
    created_at: post.created_at,
    edited_at: post.edited_at,
    is_deleted: post.is_deleted,
    reactions: post.reactions ?? {},
    my_reactions: post.my_reactions ?? [],
    comments_count: post.comments_count ?? 0,
    views_count: post.views_count ?? 0,
    waveform: post.waveform ?? undefined,
    forwarded_from: post.forwarded_from,
    forwarded_from_chat_title: post.forwarded_from_chat_title,
  };
}

function commentToMessage(comment: ChannelPostComment, chId: string): Message & { authorId?: string } {
  return {
    id: comment.id,
    chat: chId,
    sender: comment.author,
    authorId: comment.author?.id,
    msg_type: comment.msg_type,
    content: comment.content,
    file: comment.file,
    files: comment.files ?? [],
    created_at: comment.created_at,
    edited_at: comment.edited_at,
    is_deleted: comment.is_deleted,
    reactions: {},
    my_reactions: [],
    waveform: comment.waveform ?? undefined,
    reply_to: comment.reply_to
      ? {
          id: comment.reply_to.id,
          sender: comment.reply_to.author,
          msg_type: comment.reply_to.msg_type,
          content: comment.reply_to.content,
          file: comment.reply_to.file,
          created_at: comment.reply_to.created_at,
          is_deleted: comment.reply_to.is_deleted,
        }
      : null,
  };
}

function channelToChat(ch: Channel): Chat {
  return {
    id: ch.id,
    title: ch.title,
    title_icon: ch.title_icon ?? undefined,
    description: ch.description,
    slug: ch.slug,
    chat_type: null,
    is_personal: false,
    is_secret: false,
    max_members: 0,
    effective_max_members: 0,
    owner: ch.owner,
    members_count: ch.members_count,
    invite_link: ch.invite_link,
    is_active: ch.is_active,
    created_at: ch.created_at,
    last_message_at: ch.last_post_at ?? undefined,
    unread_count: 0,
    is_muted: false,
    muted_until: null,
    avatar_url: ch.avatar_url,
    background_url: null,
    is_expanded: false,
    expanded_until: null,
  };
}

/** Minimal Chat for loading shell (header + background) before real data is fetched. */
function minimalChatStub(id: string): Chat {
  return {
    id,
    title: "…",
    description: "",
    slug: "",
    chat_type: null,
    is_personal: false,
    is_secret: false,
    is_favorites: false,
    max_members: 0,
    effective_max_members: 0,
    owner: { id: "", phone: "", display_name: "" } as User,
    members_count: 0,
    invite_link: null,
    is_active: true,
    created_at: new Date().toISOString(),
    unread_count: 0,
    is_muted: false,
    muted_until: null,
    is_expanded: false,
    expanded_until: null,
    avatar_url: null,
    background_url: null,
  };
}

export default function ChatPage({
  chatId: propChatId,
  channelId: propChannelId,
  onBack,
  onChatUpdated,
  onChatLeft,
  onOpenDmWithUserId,
  onMessageSent,
  onNavigateToChat,
}: {
  chatId?: string;
  channelId?: string;
  onBack?: () => void;
  onChatUpdated?: (chat: Chat) => void;
  onChatLeft?: (chatId: string) => void;
  onOpenDmWithUserId?: (userId: string) => void;
  onMessageSent?: (chatId: string, preview: string, messageCreatedAt?: string) => void;
  onNavigateToChat?: (chatId: string) => void;
} = {}) {
  const { chatId: paramChatId, channelId: paramChannelId } = useParams<{ chatId?: string; channelId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const chatId = propChatId || paramChatId;
  const channelId = propChannelId || paramChannelId;
  const conversationId = channelId || chatId;
  const token = useAuthStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.user);
  const myUserId = currentUser?.id || "";
  const language = usePreferencesStore((s) => s.language);
  const { t, lang } = useTranslation();

  const [chat, setChat] = useState<Chat | null>(null);
  const [channelRaw, setChannelRaw] = useState<Channel | null>(null);
  /** Placeholder from chat list so we can show header/background while loading */
  const placeholderChat = useChatListStore((s) => (chatId ? s.chats.find((c) => c.id === chatId) ?? null : null));
  /** Chat to use for shell (title, avatar, background). Real chat when loaded, else placeholder or stub. */
  const displayChat = useMemo(
    () => chat ?? (chatId ? placeholderChat : null) ?? (conversationId ? minimalChatStub(conversationId) : null),
    [chat, chatId, placeholderChat, conversationId],
  );
  const shouldShowSenderNames = !!displayChat && !displayChat.is_personal && !displayChat.is_favorites;
  const displayChatBackgroundUrl = useMediaAccess(displayChat?.background_url ?? null, { enabled: !!displayChat?.background_url });
  const chatAvatarResolvedUrl = useMediaAccess(chat?.avatar_url ?? null, { enabled: !!chat?.avatar_url });

  const [members, setMembers] = useState<ChatMember[]>([]);
  const messages = useMessagesStore((s) => s.byChat[conversationId ?? ""] ?? []);
  const openPremiumModal = usePremiumModalStore((s) => s.openModal);
  const storeUpsertMessage = useMessagesStore((s) => s.upsertMessage);
  const storeLoadMessages = useMessagesStore((s) => s.loadMessages);
  const storeLoadOlderMessages = useMessagesStore((s) => s.loadOlderMessages);
  const storeUpdateMessage = useMessagesStore((s) => s.updateMessage);
  const storeReplaceTempMessage = useMessagesStore((s) => s.replaceTempMessage);
  const storeRemoveMessage = useMessagesStore((s) => s.removeMessage);
  const hasOlderMessages = useMessagesStore((s) => s.hasMoreByChat[conversationId ?? ""] ?? true);
  const loadingOlder = useMessagesStore((s) => s.loadingOlderChats[conversationId ?? ""] ?? false);
  const loadingMessages = useMessagesStore((s) => s.loadingChats[conversationId ?? ""] ?? false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [messageDeleteError, setMessageDeleteError] = useState("");
  /** Global upload progress (survives switching chats); progress for current chat's messages from activeUploads */
  const activeUploads = useUploadProgressStore((s) => s.activeUploads);
  const hasActiveUploads = useUploadProgressStore((s) => s.getActiveUploadsForChat(conversationId ?? "").length > 0);
  /** Download progress when recipient fetches file: messageId -> { loaded, total } */
  const [downloadProgressByMessageId, setDownloadProgressByMessageId] = useState<Record<string, { loaded: number; total: number }>>({});
  /** Per-file loaded bytes for multi-file upload progress (tempId -> fileIndex -> loaded) */
  const multiUploadLoadedRef = useRef<Record<string, Record<number, number>>>({});
  const [showInfo, setShowInfo] = useState(false);
  /** ID of the user whose card is open in the right panel (on avatar click). null = chat info */
  const [infoUserId, setInfoUserId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [usernameShake, setUsernameShake] = useState(false);
  const [profileUsernameLinkCopied, setProfileUsernameLinkCopied] = useState(false);
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [mediaLinksFilesTab, setMediaLinksFilesTab] = useState<"media" | "links" | "files" | "voice" | "participants">("media");
  const [copiedState, setCopiedState] = useState(false);
  const [inviteCopyShake, setInviteCopyShake] = useState(false);
  const [joinRequestsPanelHidden, setJoinRequestsPanelHidden] = useState(false);
  /** Open discussion thread for a channel post (Telegram-style comments). */
  const [openCommentsPost, setOpenCommentsPost] = useState<(Message & { authorId?: string }) | null>(null);
  const [postComments, setPostComments] = useState<(Message & { authorId?: string })[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [replyToComment, setReplyToComment] = useState<Message | null>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const isCommentsView = !!channelId && !!openCommentsPost;
  const visiblePostComments = useMemo(() => postComments.filter((msg) => !msg.is_deleted), [postComments]);
  const [subscriptionState, setSubscriptionState] = useState<{ is_valid?: boolean; has_subscription?: boolean } | null>(() => {
    try {
      const raw = localStorage.getItem("subscription_cache_v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { is_valid?: boolean; has_subscription?: boolean } | null;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (chatId && typeof localStorage !== "undefined") {
      setJoinRequestsPanelHidden(localStorage.getItem(`pingy_join_requests_hidden_${chatId}`) === "1");
    } else {
      setJoinRequestsPanelHidden(false);
    }
  }, [chatId]);

  const handleHideJoinRequestsPanel = useCallback(() => {
    if (!chatId || typeof localStorage === "undefined") return;
    localStorage.setItem(`pingy_join_requests_hidden_${chatId}`, "1");
    setJoinRequestsPanelHidden(true);
  }, [chatId]);

  useEffect(() => {
    setOpenCommentsPost(null);
    setPostComments([]);
    setCommentsError("");
    setCommentInput("");
    setReplyToComment(null);
  }, [conversationId]);

  useEffect(() => {
    if (!openCommentsPost) return;
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [openCommentsPost, postComments.length]);

  useEffect(() => {
    if (!openCommentsPost) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenCommentsPost(null);
        setReplyToComment(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [openCommentsPost]);

  useEffect(() => {
    paymentsApi
      .getSubscription()
      .then((res) => {
        const next = {
          is_valid: res.data.is_valid,
          has_subscription: res.data.has_subscription,
        };
        setSubscriptionState(next);
        localStorage.setItem("subscription_cache_v1", JSON.stringify(next));
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const hasChannelAuthorRole = useMemo(
    () => !!(channelRaw && (channelRaw.owner?.id === myUserId || channelRaw.my_role === "admin")),
    [channelRaw, myUserId],
  );
  const hasPremiumAccess = subscriptionState?.is_valid === true;
  const canCommentInChannel = !!(channelRaw?.comments_enabled && channelRaw?.my_role);
  const canPinForAll = useMemo(
    () => !!(chat && (chat.owner?.id === myUserId || members.some((m) => m.user.id === myUserId && m.role === "admin"))),
    [chat, members, myUserId],
  );
  const pinnedForAllIds = useMemo(
    () => chat?.pinned_messages?.map((m) => m.id) ?? (chat?.pinned_message ? [chat.pinned_message.id] : []),
    [chat?.pinned_messages, chat?.pinned_message],
  );
  const maxPins = chat?.max_pins ?? 1;
  const myPinnedIds = useMemo(() => chat?.my_pinned_messages?.map((m) => m.id) ?? [], [chat?.my_pinned_messages]);

  const handleMessageUpdated = useCallback(
    (updated: Message) => {
      if (!conversationId) return;
      storeUpsertMessage(conversationId, storeNormalizeMessage(updated));
    },
    [conversationId, storeUpsertMessage],
  );
  const handleReactionUpdated = useCallback(
    (messageId: string, data: { reactions: Record<string, number>; my_reactions: string[] }) => {
      if (!conversationId) return;
      storeUpdateMessage(conversationId, messageId, data);
    },
    [conversationId, storeUpdateMessage],
  );
  const handleMessageDeleted = useCallback(
    (messageId: string) => {
      if (!conversationId) return;
      storeUpdateMessage(conversationId, messageId, { is_deleted: true });
    },
    [conversationId, storeUpdateMessage],
  );

  const handleUpdateMessageContent = useCallback(
    async (messageId: string, content: string): Promise<Message> => {
      if (channelId && channelRaw) {
        const res = await channelPostsApi.update(channelId, messageId, { content });
        return channelPostToMessage(res.data, channelId, channelRaw);
      }
      const res = await messagesApi.update(chatId!, messageId, { content });
      return res.data;
    },
    [channelId, chatId, channelRaw],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (channelId) {
        await channelPostsApi.delete(channelId, messageId);
      } else {
        await messagesApi.delete(chatId!, messageId);
      }
    },
    [channelId, chatId],
  );

  const handleDeleteError = useCallback((err: unknown) => {
    const e = err as { response?: { data?: { detail?: string | string[] }; status?: number } };
    const detail = e.response?.data?.detail;
    const msg = Array.isArray(detail) ? detail[0] : typeof detail === "string" ? detail : null;
    setMessageDeleteError(msg || t("chat.messageDeleteError"));
    setTimeout(() => setMessageDeleteError(""), 5000);
  }, [t]);

  /** Create message (chat) or post (channel) — unified API for send handlers. */
  const createMessage = useCallback(
    async (data: { msg_type?: string; content?: string; file_id?: string; file_ids?: string[]; waveform?: number[]; duration_seconds?: number; reply_to_id?: string }) => {
      if (channelId) {
        const res = await channelPostsApi.create(channelId, {
          msg_type: data.msg_type ?? "text",
          content: data.content ?? "",
          file_id: data.file_id ?? undefined,
          file_ids: data.file_ids,
          waveform: data.waveform,
          duration_seconds: data.duration_seconds,
        });
        const msg = channelPostToMessage(res.data, channelId, channelRaw);
        storeUpsertMessage(channelId, msg);
        return { data: msg };
      }
      return messagesApi.create(chatId!, data);
    },
    [channelId, chatId, channelRaw, storeUpsertMessage],
  );

  const handleStartEditInInput = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setInputAndEditable((content || "").trim());
  }, []);
  const handleReply = useCallback((m: Message) => {
    setReplyToMessage(m);
    inputEditableRef.current?.focus();
  }, []);
  const handleForward = useCallback((m: Message) => setForwardModalMessages([m]), []);
  const updateChannelPostCommentsCount = useCallback((postId: string, commentsCount: number) => {
    if (!channelId) return;
    const nextCount = Math.max(0, commentsCount);
    storeUpdateMessage(channelId, postId, { comments_count: nextCount });
    setOpenCommentsPost((prev) => (prev && prev.id === postId ? { ...prev, comments_count: nextCount } : prev));
  }, [channelId, storeUpdateMessage]);
  const loadChannelPostComments = useCallback(async (postId: string) => {
    if (!channelId) return;
    setCommentsLoading(true);
    setCommentsError("");
    try {
      const res = await channelPostCommentsApi.list(channelId, postId, { limit: CHANNEL_COMMENTS_PAGE_SIZE, offset: 0 });
      const rows = Array.isArray(res.data) ? res.data : [];
      setPostComments(rows.map((comment) => commentToMessage(comment, channelId)));
      updateChannelPostCommentsCount(postId, rows.filter((comment) => !comment.is_deleted).length);
    } catch {
      setCommentsError(t("channelComments.loadError"));
    } finally {
      setCommentsLoading(false);
    }
  }, [channelId, t, updateChannelPostCommentsCount]);
  const openPostComments = useCallback((post: Message) => {
    setOpenCommentsPost(post as Message & { authorId?: string });
    setPostComments([]);
    setCommentsError("");
    setCommentInput("");
    setReplyToComment(null);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setShowInfo(false);
    void loadChannelPostComments(post.id);
  }, [loadChannelPostComments]);
  const closePostComments = useCallback(() => {
    setOpenCommentsPost(null);
    setReplyToComment(null);
    setCommentsError("");
    setCommentInput("");
  }, []);
  const handleBackAction = useCallback(() => {
    if (isCommentsView) {
      closePostComments();
      return;
    }
    onBack?.();
  }, [closePostComments, isCommentsView, onBack]);
  const handleCommentsPostUpdated = useCallback((updated: Message) => {
    handleMessageUpdated(updated);
    setOpenCommentsPost((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }, [handleMessageUpdated]);
  const handleChannelPostReactionUpdated = useCallback((messageId: string, data: { reactions: Record<string, number>; my_reactions: string[] }) => {
    handleReactionUpdated(messageId, data);
    setOpenCommentsPost((prev) => (prev && prev.id === messageId ? { ...prev, reactions: data.reactions, my_reactions: data.my_reactions } : prev));
  }, [handleReactionUpdated]);
  const handleCommentUpdated = useCallback((updated: Message) => {
    setPostComments((prev) => prev.map((msg) => (msg.id === updated.id ? { ...msg, ...updated } : msg)));
  }, []);
  const handleCommentDeleted = useCallback((messageId: string) => {
    setPostComments((prev) => {
      const next = prev.map((msg) => (msg.id === messageId ? { ...msg, is_deleted: true } : msg));
      if (openCommentsPost) {
        updateChannelPostCommentsCount(openCommentsPost.id, next.filter((msg) => !msg.is_deleted).length);
      }
      return next;
    });
    setReplyToComment((prev) => (prev?.id === messageId ? null : prev));
  }, [openCommentsPost, updateChannelPostCommentsCount]);
  const handleUpdateCommentContent = useCallback(async (messageId: string, content: string): Promise<Message> => {
    if (!channelId || !openCommentsPost) throw new Error("Discussion is not open");
    const res = await channelPostCommentsApi.update(channelId, openCommentsPost.id, messageId, { content });
    return commentToMessage(res.data, channelId);
  }, [channelId, openCommentsPost]);
  const handleDeleteComment = useCallback(async (messageId: string) => {
    if (!channelId || !openCommentsPost) return;
    await channelPostCommentsApi.delete(channelId, openCommentsPost.id, messageId);
  }, [channelId, openCommentsPost]);
  const handleSendComment = useCallback(async () => {
    if (!channelId || !openCommentsPost) return;
    if (!canCommentInChannel) return;
    if (!hasPremiumAccess) {
      openPremiumModal();
      return;
    }
    const trimmed = commentInput.trim();
    if (!trimmed) return;
    setCommentSubmitting(true);
    setCommentsError("");
    try {
      const res = await channelPostCommentsApi.create(channelId, openCommentsPost.id, {
        msg_type: "text",
        content: trimmed,
        ...(replyToComment ? { reply_to_id: replyToComment.id } : {}),
      });
      const nextComment = commentToMessage(res.data, channelId);
      setPostComments((prev) => {
        const next = [...prev, nextComment];
        updateChannelPostCommentsCount(openCommentsPost.id, next.filter((msg) => !msg.is_deleted).length);
        return next;
      });
      setCommentInput("");
      setReplyToComment(null);
    } catch {
      setCommentsError(t("channelComments.sendError"));
    } finally {
      setCommentSubmitting(false);
    }
  }, [canCommentInChannel, channelId, commentInput, hasPremiumAccess, openCommentsPost, openPremiumModal, replyToComment, t, updateChannelPostCommentsCount]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  /** Только у одного сообщения может быть открыт пикер реакций; при открытии другого — предыдущий закрывается. */
  const [openReactionPickerMessageId, setOpenReactionPickerMessageId] = useState<string | null>(null);
  const handleEnterSelectionMode = useCallback((preselectId?: string) => {
    setSelectionMode(true);
    setSelectedMessageIds(preselectId ? new Set([preselectId]) : new Set());
  }, []);
  const handleExitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, []);
  const handleToggleSelect = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);
  const handleBulkDelete = useCallback(async () => {
    if (!chatId || selectedMessageIds.size === 0) return;
    try {
      const ids = Array.from(selectedMessageIds);
      await messagesApi.bulkDelete(chatId, ids);
      ids.forEach((id) => storeUpdateMessage(chatId, id, { is_deleted: true }));
      handleExitSelectionMode();
    } catch {
      // Error handling
    }
  }, [chatId, selectedMessageIds, storeUpdateMessage, handleExitSelectionMode]);
  const handleBulkForward = useCallback(() => {
    const msgs = Array.from(selectedMessageIds)
      .map((id) => messages.find((m) => m.id === id))
      .filter((m): m is Message => !!m);
    if (msgs.length > 0) {
      setForwardModalMessages(msgs);
    }
  }, [selectedMessageIds, messages]);
  const handleAvatarClick = useCallback(() => {
    setShowInfo(true);
    if (!chat?.is_personal) setMediaLinksFilesTab("participants");
  }, [chat?.is_personal]);

  useEffect(() => {
    const openInfoUserId = (location.state as { openInfoUserId?: string } | null)?.openInfoUserId;
    if (!openInfoUserId) return;
    setInfoUserId(openInfoUserId);
    setShowInfo(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  /** Voice mode: record file or AI transcription. Пока отключено переключение на AI-ввод (речь → текст), только запись аудио. */
  const [voiceInputMode] = useState<"record" | "ai">("record");
  // const [voiceInputMode, setVoiceInputMode] = useState<"record" | "ai">(() => {
  //   try {
  //     const v = localStorage.getItem("chat_voice_input_mode");
  //     return v === "ai" ? "ai" : "record";
  //   } catch {
  //     return "record";
  //   }
  // });
  /** Whether AI speech recognition is active (transcription into the input field). */
  const [aiListening, setAiListening] = useState(false);
  /** Right-click context menu on the microphone button (mode toggle). */
  /** Current amplitudes for waveform visualization during recording (32 bars) */
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);
  /** Volume level during recording (0..255) for the indicator */
  const [voiceLevel, setVoiceLevel] = useState(0);
  /** Online statuses of users: userId → { is_online, last_seen_display } */
  const [onlineStatus, setOnlineStatus] = useState<Record<string, { is_online: boolean; last_seen_display?: string | null }>>({});
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  const [muteLoading, setMuteLoading] = useState(false);
  const [scheduledList, setScheduledList] = useState<ScheduledMessageType[]>([]);
  const [scheduleMenuPos, setScheduleMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showStickerGifPanel, setShowStickerGifPanel] = useState(false);
  /** Send without sound (toggle via right-click on send) */
  const [sendWithoutSoundMode, setSendWithoutSoundMode] = useState(false);
  const sendWithoutSoundRef = useRef(false);
  useEffect(() => { sendWithoutSoundRef.current = sendWithoutSoundMode; }, [sendWithoutSoundMode]);
  const [showCreatePollModal, setShowCreatePollModal] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachAsFileOnlyRef = useRef(false);
  const [showContactPickerModal, setShowContactPickerModal] = useState(false);
  const [showStickerPackManagerModal, setShowStickerPackManagerModal] = useState(false);
  const [stickerRefreshToken, setStickerRefreshToken] = useState(0);
  const stickerGifPickerRef = useRef<HTMLDivElement>(null);
  /** Editing a message in the input field (for emoji-only messages) */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [formatMenuPos, setFormatMenuPos] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  /** Message being replied to (reply bar above input) */
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  /** Messages to forward (opens ForwardModal). Single or multiple. */
  const [forwardModalMessages, setForwardModalMessages] = useState<Message[] | null>(null);
  /** Telegram-style pinned messages: index currently shown */
  const [pinnedIndex, setPinnedIndex] = useState(0);
  /** View a single image in a modal overlay on top of the chat */
  /** Files for preview before sending (modal). asFileOnly: send everything as a file (drop into the upper zone) */
  const [pendingFilesForPreview, setPendingFilesForPreview] = useState<File[] | null>(null);
  const [pendingFilesAsFileOnly, setPendingFilesAsFileOnly] = useState(false);
  /** @-mention picker: open state, @ position in input, selected index */
  const [mentionPicker, setMentionPicker] = useState<{ open: boolean; start: number; selectedIndex: number }>({ open: false, start: 0, selectedIndex: 0 });
  /** Emoji shortcode picker (:thu → 👍): open state, : position, selected index */
  const [emojiPicker, setEmojiPicker] = useState<{ open: boolean; start: number; selectedIndex: number }>({ open: false, start: 0, selectedIndex: 0 });
  /** Unread on chat entry: message IDs whose bottom edge has not yet entered the visible area */
  const [initialUnreadIds, setInitialUnreadIds] = useState<string[]>([]);
  /** IDs of messages whose bottom edge has already been in the visible area */
  const [seenBottomIds, setSeenBottomIds] = useState<Set<string>>(new Set());
  /** "Unread" line hidden after all initialUnreadIds are read and markRead is called */
  const [unreadLineDismissed, setUnreadLineDismissed] = useState(false);
  const sentinelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputEditableRef = useRef<HTMLDivElement>(null);
  const filePreviewConfirmRef = useRef<(() => void) | null>(null);
  const savedFormatRangeRef = useRef<Range | null>(null);
  const undoStackRef = useRef<string[]>([""]);
  const undoIndexRef = useRef(0);
  /** Cache: ciphertext → plaintext for own sent encrypted messages (so we can display them when the WS echo arrives). */
  const sentPlaintextCacheRef = useRef<Map<string, string>>(new Map());
  // upsertMessageChronologically is now handled by useMessagesStore.upsertMessage

  /* ── Long-press refs for mobile context actions ── */
  const lpSendRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpSendFiredRef = useRef(false);
  const lpVoiceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpVoiceFiredRef = useRef(false);
  const lpInputRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpInputFiredRef = useRef(false);

  /** Set both the markdown state and the contenteditable display (for programmatic content changes) */
  const setInputAndEditable = useCallback((markdown: string) => {
    setInput(markdown);
    const el = inputEditableRef.current;
    if (el) el.innerHTML = markdownToHtml(markdown);
  }, []);

  const pushUndoState = useCallback((value: string) => {
    const stack = undoStackRef.current.slice(0, undoIndexRef.current + 1);
    stack.push(value);
    if (stack.length > 50) stack.splice(0, stack.length - 50);
    undoStackRef.current = stack;
    undoIndexRef.current = stack.length - 1;
  }, []);

  const resetUndoStack = useCallback(() => {
    undoStackRef.current = [""];
    undoIndexRef.current = 0;
  }, []);

  /** Apply formatting via execCommand in contenteditable (saved selection in savedFormatRangeRef) */
  const applyFormatInEditable = useCallback((cmd: string, value?: string) => {
    const el = inputEditableRef.current;
    const range = savedFormatRangeRef.current;
    if (!el || !range) return;
    pushUndoState(htmlToMarkdown(el.innerHTML));
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      if (value != null) document.execCommand(cmd, false, value);
      else document.execCommand(cmd, false);
    }
    setInput(htmlToMarkdown(el.innerHTML));
    setFormatMenuPos(null);
    setTimeout(() => el.focus(), 0);
  }, [pushUndoState]);

  const handleFormatBold = () => {
    if (!formatMenuPos) return;
    applyFormatInEditable("bold");
  };
  const handleFormatItalic = () => {
    if (!formatMenuPos) return;
    applyFormatInEditable("italic");
  };
  const handleFormatStrike = () => {
    if (!formatMenuPos) return;
    applyFormatInEditable("strikeThrough");
  };
  const handleFormatLink = () => {
    if (!formatMenuPos) return;
    const url = window.prompt(t("chat.enterUrl"), "https://");
    if (url == null) return;
    applyFormatInEditable("createLink", url);
  };
  const handleFormatCopyable = () => {
    const el = inputEditableRef.current;
    const range = savedFormatRangeRef.current;
    if (!el || !range) return;
    const text = range.toString();
    if (!text) return;
    pushUndoState(htmlToMarkdown(el.innerHTML));
    const span = document.createElement("span");
    span.setAttribute("data-copy", "true");
    span.textContent = text;
    range.deleteContents();
    range.insertNode(span);
    setInput(htmlToMarkdown(el.innerHTML));
    setFormatMenuPos(null);
    setTimeout(() => el.focus(), 0);
  };

  /** Apply formatting via keyboard shortcuts in contenteditable (Ctrl+B, Ctrl+I, etc.). */
  const applyFormatShortcut = useCallback((cmd: string, value?: string) => {
    const el = inputEditableRef.current;
    if (!el) return;
    pushUndoState(htmlToMarkdown(el.innerHTML));
    if (value != null) document.execCommand(cmd, false, value);
    else document.execCommand(cmd, false);
    setInput(htmlToMarkdown(el.innerHTML));
    setTimeout(() => el.focus(), 0);
  }, [pushUndoState]);

  /** Toggle keyboard layout EN↔RU: for selected text or the entire input field. */
  const handleSwitchLayout = useCallback(() => {
    const el = inputEditableRef.current;
    if (!el) return;
    const sel = window.getSelection();
    // If there's a selection inside the field — convert only the selected text
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const selectedText = range.toString();
      if (selectedText) {
        pushUndoState(htmlToMarkdown(el.innerHTML));
        const converted = switchLayout(selectedText);
        range.deleteContents();
        range.insertNode(document.createTextNode(converted));
        // Restore selection on converted text
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(range.startContainer);
        sel.addRange(newRange);
        setInput(htmlToMarkdown(el.innerHTML));
        return;
      }
    }
    // Otherwise — convert entire content
    const md = htmlToMarkdown(el.innerHTML);
    if (!md.trim()) return;
    pushUndoState(md);
    const converted = switchLayout(md);
    setInputAndEditable(converted);
    setTimeout(() => el.focus(), 0);
  }, [pushUndoState, setInputAndEditable]);


  /* Chat edit state */
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [savingChat, setSavingChat] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"leave" | "delete" | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [approveRejectLoading, setApproveRejectLoading] = useState<string | null>(null);
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [inviteSearchResults, setInviteSearchResults] = useState<UserSearchResult[]>([]);
  const [inviteSearchLoading, setInviteSearchLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const [showImportTelegramModal, setShowImportTelegramModal] = useState(false);
  const [showImportTelegramChatModal, setShowImportTelegramChatModal] = useState(false);
  const [showManageImportModal, setShowManageImportModal] = useState(false);
  const [showSecretChatWarning, setShowSecretChatWarning] = useState(false);
  const [secretChatCreating, setSecretChatCreating] = useState(false);
  // Message search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchIdx, setSearchIdx] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoMenuRef = useRef<HTMLDivElement>(null);
  const muteFlyoutRef = useRef<HTMLDivElement>(null);
  const muteFlyoutAnchorRef = useRef<HTMLDivElement>(null);
  const muteFlyoutCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMuteFlyout, setShowMuteFlyout] = useState(false);
  const [muteFlyoutPos, setMuteFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  const [showAvatarFullscreen, setShowAvatarFullscreen] = useState<string | null>(null);
  const fullscreenAvatarResolvedUrl = useMediaAccess(showAvatarFullscreen, { enabled: !!showAvatarFullscreen });
  /** ID of the user whose card is open in the right panel (on avatar click). null = show chat info */
  /* Video recording state */
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoRecordingTime, setVideoRecordingTime] = useState(0);

  /* Drag-and-drop state */
  const [dragOver, setDragOver] = useState(false);
  const [dropZone, setDropZone] = useState<"top" | "bottom" | null>(null);
  const dragCounterRef = useRef(0);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const [chatAreaWidth, setChatAreaWidth] = useState(0);
  const [chatAreaBounds, setChatAreaBounds] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD_PX = 80;
  const INFO_PANEL_WIDTH_PX = 320;
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesWrapperRef = useRef<HTMLDivElement>(null);
  const rowHeightsRef = useRef<Map<string, number>>(new Map());
  const [virtualMeasureTick, setVirtualMeasureTick] = useState(0);
  // If late content (images/fonts/decryption) changes row heights, keep the viewport pinned to bottom
  // when the user was already at the bottom to avoid a visible "gap" above the composer.
  const pinToBottomAfterMeasureRef = useRef(false);
  const [messagesScrollTop, setMessagesScrollTop] = useState(0);
  const [messagesViewportHeight, setMessagesViewportHeight] = useState(0);
  /** Tracks when the scroll root is mounted so the load-more observer can attach after refs are set (fixes prod). */
  const [scrollRootReady, setScrollRootReady] = useState(false);
  const setMessagesScrollRef = useCallback((el: HTMLDivElement | null) => {
    (messagesScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setScrollRootReady(!!el);
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const notifWsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** conversationId for which we already ran initial scroll-to-bottom (so we only scroll once per chat open). */
  const initialScrollDoneForChatIdRef = useRef<string | null>(null);

  const BOTTOM_ANCHOR_MAX_MESSAGES = 30;
  const useBottomAnchor = messages.length > 0 && messages.length <= BOTTOM_ANCHOR_MAX_MESSAGES;

  const isScrolledToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return true;
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const messageIndexById = useMemo(() => {
    const idx = new Map<string, number>();
    messages.forEach((m, i) => idx.set(m.id, i));
    return idx;
  }, [messages]);

  const virtualState = useMemo(() => {
    const count = messages.length;
    const offsets = new Array<number>(count + 1);
    offsets[0] = 0;
    for (let i = 0; i < count; i += 1) {
      const id = messages[i].id;
      const rowHeight = rowHeightsRef.current.get(id) ?? VIRTUAL_ROW_ESTIMATE;
      offsets[i + 1] = offsets[i] + rowHeight;
    }

    const enabled = count >= VIRTUALIZATION_THRESHOLD && messagesViewportHeight > 0;
    if (!enabled) {
      return {
        enabled: false,
        start: 0,
        end: count,
        topPadding: 0,
        bottomPadding: 0,
        offsets,
      };
    }

    const viewTop = Math.max(0, messagesScrollTop);
    const viewBottom = viewTop + messagesViewportHeight;
    const start = Math.max(0, lowerBound(offsets, viewTop) - 1 - VIRTUAL_OVERSCAN);
    const end = Math.min(count, lowerBound(offsets, viewBottom) + VIRTUAL_OVERSCAN);
    return {
      enabled: true,
      start,
      end,
      topPadding: offsets[start],
      bottomPadding: Math.max(0, offsets[count] - offsets[end]),
      offsets,
    };
  }, [messages, messagesScrollTop, messagesViewportHeight, virtualMeasureTick]);

  const flashHighlightMessage = useCallback((anchor: Element | null) => {
    const msgEl = anchor?.previousElementSibling as HTMLElement | null;
    if (!msgEl) return;
    msgEl.classList.remove("msg-highlight-flash");
    // force reflow so re-adding the class restarts the animation
    void msgEl.offsetWidth;
    msgEl.classList.add("msg-highlight-flash");
    const onEnd = () => { msgEl.classList.remove("msg-highlight-flash"); msgEl.removeEventListener("animationend", onEnd); };
    msgEl.addEventListener("animationend", onEnd);
  }, []);

  const scrollToMessageId = useCallback((messageId: string) => {
    const scrollRoot = messagesScrollRef.current;
    const anchor = document.querySelector(`[data-message-id="${messageId}"]`);
    if (anchor) {
      (anchor.previousElementSibling as HTMLElement)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      setTimeout(() => flashHighlightMessage(anchor), 350);
      setShowInfo(false);
      return;
    }
    const idx = messageIndexById.get(messageId);
    if (scrollRoot && idx !== undefined) {
      const approxTop = virtualState.offsets[idx] ?? (idx * VIRTUAL_ROW_ESTIMATE);
      scrollRoot.scrollTop = Math.max(0, approxTop - 120);
      requestAnimationFrame(() => {
        const delayedAnchor = document.querySelector(`[data-message-id="${messageId}"]`);
        (delayedAnchor?.previousElementSibling as HTMLElement)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        setTimeout(() => flashHighlightMessage(delayedAnchor), 350);
      });
    }
    setShowInfo(false);
  }, [messageIndexById, virtualState.offsets, flashHighlightMessage]);

  useEffect(() => {
    const targetMessageId = (location.state as { targetMessageId?: string } | null)?.targetMessageId;
    if (!targetMessageId) return;
    scrollToMessageId(targetMessageId);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, scrollToMessageId]);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (el) setMessagesScrollTop(el.scrollTop);
    setShowScrollToBottom(!isScrolledToBottom());
  }, [isScrolledToBottom]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRafRef = useRef<number | null>(null);
  const amplitudeSamplesRef = useRef<number[]>([]);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognitionLike | null>(null);

  const scrollToBottomInstant = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  /** Плавная прокрутка вниз: быстрый старт, быстрая перемотка, медленное торможение (ease-out). */
  const scrollToBottomSmooth = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const startTop = el.scrollTop;
    const endTop = el.scrollHeight - el.clientHeight;
    if (startTop >= endTop - 2) return;
    const duration = 320;
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      el.scrollTop = startTop + (endTop - startTop) * easeOutCubic(t);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  useLayoutEffect(() => {
    if (!pinToBottomAfterMeasureRef.current) return;
    pinToBottomAfterMeasureRef.current = false;
    scrollToBottomInstant();
  }, [virtualMeasureTick, scrollToBottomInstant]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // When opening a chat, scroll to bottom as soon as messages appear (including from cache) so the user sees newest first.
  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0) return;
    if (initialScrollDoneForChatIdRef.current === conversationId) return;
    initialScrollDoneForChatIdRef.current = conversationId;
    scrollToBottomInstant();
  }, [conversationId, messages.length, scrollToBottomInstant]);

  /** Проматывает чат в самый низ после следующего рендера (для использования после отправки сообщения) — плавно с ease-out. */
  const scheduleScrollToBottomAfterSend = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottomSmooth()));
  }, [scrollToBottomSmooth]);

  /* ---------- Load older messages on scroll up (pagination) ---------- */
  useEffect(() => {
    if (!conversationId || !scrollRootReady) return;
    const sentinel = loadMoreSentinelRef.current;
    const scrollRoot = messagesScrollRef.current;
    if (!sentinel || !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasOlderMessages && !loadingOlder) {
          // Save scroll position before prepending older messages
          const prevScrollHeight = scrollRoot.scrollHeight;
          const cid = conversationId!;
          if (channelId) {
            useMessagesStore.setState((s) => ({ loadingOlderChats: { ...s.loadingOlderChats, [cid]: true } }));
          }
          const loadOlder = channelId
            ? (channelRaw ? (async () => {
                const existing = useMessagesStore.getState().byChat[channelId] ?? [];
                if (existing.length === 0) return [];
                const oldest = existing[0];
                const res = await channelPostsApi.list(channelId, { before: oldest.created_at });
                const msgs = res.data.map((p) => channelPostToMessage(p, channelId, channelRaw));
                useMessagesStore.setState((s) => {
                  const current = s.byChat[channelId] ?? [];
                  const existingIds = new Set(current.map((m) => m.id));
                  const unique = msgs.filter((m) => !existingIds.has(m.id));
                  return {
                    byChat: { ...s.byChat, [channelId]: [...unique, ...current] },
                    hasMoreByChat: { ...s.hasMoreByChat, [channelId]: res.hasMore },
                    loadingOlderChats: { ...s.loadingOlderChats, [cid]: false },
                  };
                });
                return msgs;
              })() : Promise.resolve([]))
            : storeLoadOlderMessages(chatId!);
          loadOlder.then((prepended) => {
            if (prepended.length > 0) {
              // Restore scroll position after DOM update
              requestAnimationFrame(() => {
                const newScrollHeight = scrollRoot.scrollHeight;
                scrollRoot.scrollTop += newScrollHeight - prevScrollHeight;
              });
            }
          }).finally(() => {
            if (channelId) {
              useMessagesStore.setState((s) => ({ loadingOlderChats: { ...s.loadingOlderChats, [cid]: false } }));
            }
          });
        }
      },
      { root: scrollRoot, threshold: 0, rootMargin: "2400px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conversationId, chatId, channelId, channelRaw, hasOlderMessages, loadingOlder, storeLoadOlderMessages, scrollRootReady, messages.length]);

  /* ---------- Send text (after scrollToBottom so it can be used in deps) ---------- */
  const sendTextInFlightRef = useRef(false);
  const lastSendFingerprintRef = useRef<{ key: string; at: number } | null>(null);
  const sendTextMessage = useCallback(async (text: string) => {
    if (!conversationId || !text.trim()) return;
    const trimmedText = text.trim();
    if (trimmedText.length > MESSAGE_MAX_LENGTH) return;
    const replyId = replyToMessage?.id || undefined;
    const trimmed = trimmedText;
    // Guard against accidental double-send (double-click / Enter + click / mobile tap quirks).
    const fp = `${conversationId}|${replyId || ""}|${trimmed}`;
    const now = Date.now();
    if (sendTextInFlightRef.current) return;
    if (lastSendFingerprintRef.current && lastSendFingerprintRef.current.key === fp && (now - lastSendFingerprintRef.current.at) < 1200) {
      return;
    }
    sendTextInFlightRef.current = true;
    lastSendFingerprintRef.current = { key: fp, at: now };

    const clearInputAndReply = () => {
      setInput("");
      setReplyToMessage(null);
      if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(`pingy_draft_v1:${conversationId}`);
      } catch { /* ignore */ }
      resetUndoStack();
    };

    const sendViaRest = (data: { msg_type: string; content: string; reply_to_id?: string }) => {
      createMessage(data).then((res) => {
        const msg = storeNormalizeMessage(res.data);
        storeUpsertMessage(conversationId, msg);
        broadcastMessageCreated(conversationId, msg);
        scheduleScrollToBottomAfterSend();
        onMessageSent?.(conversationId, formatMessagePreview(res.data, lang), res.data.created_at);
        if (!sendWithoutSoundRef.current) playSound("send");
        clearInputAndReply();
      }).finally(() => {
        sendTextInFlightRef.current = false;
      }).catch((err) => {
        const detail = (err as { response?: { data?: { detail?: string | string[] } } })?.response?.data?.detail;
        const msg = Array.isArray(detail) ? detail[0] : (typeof detail === "string" ? detail : null) || t("chat.sendError");
        setUploadError(msg);
        setTimeout(() => setUploadError(""), 4000);
      });
    };

    const doSendPlain = () => {
      if (channelId) {
        if (!hasPremiumAccess) {
          openPremiumModal();
          sendTextInFlightRef.current = false;
          return;
        }
        sendViaRest({ msg_type: "text", content: trimmed, ...(replyId ? { reply_to_id: replyId } : {}) });
        return;
      }
      if (!useNetworkStore.getState().isOnline) {
        useOutboxStore.getState().enqueue({ chatId: chatId!, msgType: "text", content: trimmed });
        scheduleScrollToBottomAfterSend();
        clearInputAndReply();
        sendTextInFlightRef.current = false;
        return;
      }
      // Always use REST for non-secret chats so message is saved and displayed even when WebSocket is pending/broken
      sendViaRest({ msg_type: "text", content: trimmed, ...(replyId ? { reply_to_id: replyId } : {}) });
    };

    if (!channelId && chat?.is_secret && chat.other_member) {
      try {
        const encPayload = await prepareEncryptedMessage(myUserId, chat, trimmed, replyId);
        if (encPayload) {
          // Cache plaintext so we can display it when the WS echo arrives
          sentPlaintextCacheRef.current.set(encPayload.content, trimmed);
          // Prevent unbounded growth: keep only last 100 entries
          if (sentPlaintextCacheRef.current.size > 100) {
            const first = sentPlaintextCacheRef.current.keys().next().value;
            if (first !== undefined) sentPlaintextCacheRef.current.delete(first);
          }
          if (chatWsRef.current?.isConnected()) {
            chatWsRef.current.send(encPayload);
            if (!sendWithoutSoundRef.current) playSound("send");
            scheduleScrollToBottomAfterSend();
            clearInputAndReply();
            sendTextInFlightRef.current = false;
          } else if (!useNetworkStore.getState().isOnline) {
            useOutboxStore.getState().enqueue({ chatId: chatId!, msgType: "text", content: trimmed });
            scheduleScrollToBottomAfterSend();
            clearInputAndReply();
            sendTextInFlightRef.current = false;
          } else {
            messagesApi.create(chatId!, {
              msg_type: "text",
              content: encPayload.content,
              is_encrypted: true,
              sender_device_id: encPayload.sender_device_id,
              encrypted_keys: encPayload.encrypted_keys,
              ...(replyId ? { reply_to_id: replyId } : {}),
            }).then((res) => {
              const msgData = { ...res.data, content: trimmed };
              const msg = storeNormalizeMessage(msgData);
              storeUpsertMessage(chatId!, msg);
              broadcastMessageCreated(chatId!, msg);
              scheduleScrollToBottomAfterSend();
              onMessageSent?.(chatId!, formatMessagePreview({ content: trimmed }, lang));
              if (!sendWithoutSoundRef.current) playSound("send");
              clearInputAndReply();
              sendTextInFlightRef.current = false;
            }).catch((err) => {
              const detail = (err as { response?: { data?: { detail?: string | string[] } } })?.response?.data?.detail;
              const msg = Array.isArray(detail) ? detail[0] : (typeof detail === "string" ? detail : null) || t("chat.sendError");
              setUploadError(msg);
              setTimeout(() => setUploadError(""), 4000);
              sendTextInFlightRef.current = false;
            });
          }
          return;
        }
      } catch {
        /* fall back to plain */
      }
    }
    doSendPlain();
    sendTextInFlightRef.current = false;
  }, [conversationId, chatId, channelId, chat, replyToMessage, resetUndoStack, scheduleScrollToBottomAfterSend, onMessageSent, storeUpsertMessage, createMessage, t, hasPremiumAccess, openPremiumModal]);

  const handleSelectGif = useCallback((url: string) => {
    if (!conversationId || !url) return;
    setShowStickerGifPanel(false);
    const replyId = replyToMessage?.id;
    if (channelId) {
      if (!hasPremiumAccess) {
        openPremiumModal();
        return;
      }
      createMessage({ msg_type: "gif", content: url, ...(replyId ? { reply_to_id: replyId } : {}) }).then((res) => {
        const msg = storeNormalizeMessage(res.data);
        storeUpsertMessage(conversationId, msg);
        broadcastMessageCreated(conversationId, msg);
        scheduleScrollToBottomAfterSend();
        onMessageSent?.(conversationId, formatMessagePreview(res.data, lang), res.data.created_at);
        if (!sendWithoutSoundRef.current) playSound("send");
      });
    } else if (chatWsRef.current?.isConnected()) {
      chatWsRef.current.send({ type: "chat.message" as const, msg_type: "gif", content: url, ...(replyId ? { reply_to: replyId } : {}) });
      if (!sendWithoutSoundRef.current) playSound("send");
      scheduleScrollToBottomAfterSend();
    } else if (!useNetworkStore.getState().isOnline) {
      useOutboxStore.getState().enqueue({ chatId: chatId!, msgType: "gif", content: url });
      scheduleScrollToBottomAfterSend();
    } else {
      createMessage({ msg_type: "gif", content: url, ...(replyId ? { reply_to_id: replyId } : {}) }).then((res) => {
        const msg = storeNormalizeMessage(res.data);
        storeUpsertMessage(conversationId, msg);
        broadcastMessageCreated(conversationId, msg);
        scheduleScrollToBottomAfterSend();
        onMessageSent?.(conversationId, formatMessagePreview(res.data, lang), res.data.created_at);
        if (!sendWithoutSoundRef.current) playSound("send");
      });
    }
    setReplyToMessage(null);
  }, [conversationId, chatId, channelId, replyToMessage, scheduleScrollToBottomAfterSend, onMessageSent, storeUpsertMessage, createMessage, hasPremiumAccess, openPremiumModal]);

  const handleSelectSticker = useCallback(
    (pathOrSticker: import("../components/StickerGifPanel").StickerSelection) => {
      if (!conversationId) return;
      const isUserSticker = typeof pathOrSticker === "object";
      const path = isUserSticker ? "" : (pathOrSticker as string);
      const fileId = isUserSticker ? (pathOrSticker as { fileId: string }).fileId : undefined;
      const stickerId = isUserSticker ? (pathOrSticker as { id: string }).id : undefined;
      if (!path && !fileId) return;
      setShowStickerGifPanel(false);
      const replyId = replyToMessage?.id;
      const doSaveRecent = stickerId ? () => stickersApi.saveRecent(stickerId).catch(() => {}) : undefined;

      const sendSticker = () => {
        createMessage({ msg_type: "sticker", content: path || "", ...(fileId ? { file_id: fileId } : {}), ...(replyId ? { reply_to_id: replyId } : {}) })
          .then((res) => {
            storeUpsertMessage(conversationId, storeNormalizeMessage(res.data));
            scheduleScrollToBottomAfterSend();
            onMessageSent?.(conversationId, formatMessagePreview(res.data, lang), res.data.created_at);
            if (!sendWithoutSoundRef.current) playSound("send");
            doSaveRecent?.();
          });
      };

      if (channelId) {
        if (!hasPremiumAccess) {
          openPremiumModal();
          return;
        }
        sendSticker();
      } else if (chatWsRef.current?.isConnected()) {
        chatWsRef.current.send({
          type: "chat.message" as const,
          msg_type: "sticker",
          content: path || "",
          ...(fileId ? { file_id: fileId } : {}),
          ...(replyId ? { reply_to: replyId } : {}),
        });
        doSaveRecent?.();
        scheduleScrollToBottomAfterSend();
      } else if (!useNetworkStore.getState().isOnline) {
        useOutboxStore.getState().enqueue({
          chatId: chatId!,
          msgType: "sticker",
          content: path,
          ...(fileId ? { fileIds: [fileId] } : {}),
        });
        scheduleScrollToBottomAfterSend();
        doSaveRecent?.();
      } else {
        sendSticker();
      }
      setReplyToMessage(null);
    },
    [conversationId, chatId, channelId, replyToMessage, scheduleScrollToBottomAfterSend, onMessageSent, storeUpsertMessage, createMessage, hasPremiumAccess, openPremiumModal]
  );

  const handleCreatePoll = useCallback((question: string, options: string[], multiple: boolean, anonymous: boolean, quiz?: boolean, correctIndex?: number) => {
    if (!chatId || channelId) return Promise.resolve(); // Polls not supported in channels
    const pollData: { options: string[]; multiple: boolean; anonymous: boolean; quiz?: boolean; correct_index?: number } = { options, multiple, anonymous };
    if (quiz && typeof correctIndex === "number") {
      pollData.quiz = true;
      pollData.correct_index = correctIndex;
    }
    return messagesApi.create(chatId, {
      msg_type: "poll",
      content: question,
      poll_data: pollData,
    }).then((res) => {
      storeUpsertMessage(chatId, storeNormalizeMessage(res.data));
      scheduleScrollToBottomAfterSend();
      onMessageSent?.(chatId, formatMessagePreview(res.data, lang), res.data.created_at);
      if (!sendWithoutSoundRef.current) playSound("send");
      setReplyToMessage(null);
    });
  }, [chatId, channelId, scheduleScrollToBottomAfterSend, onMessageSent, storeUpsertMessage]);

  const [editablePlainCursor, setEditablePlainCursor] = useState({ plain: "", cursor: 0 });
  const mentionableMembers = members.filter((m) => m.status === "active" && (m.user as User).id !== myUserId);
  const mentionQuery = mentionPicker.open
    ? editablePlainCursor.plain.slice(mentionPicker.start + 1, editablePlainCursor.cursor).replace(/\s/g, " ")
    : "";
  const mentionFiltered = mentionQuery.length === 0
    ? mentionableMembers
    : mentionableMembers.filter((m) => {
        const u = m.user as User;
        const q = mentionQuery.toLowerCase().trim();
        const username = (u.username || "").toLowerCase();
        const displayName = (u.display_name || "").toLowerCase();
        const phone = (u.phone || "").toLowerCase();
        return username.includes(q) || displayName.includes(q) || phone.includes(q);
      });

  const emojiQuery = emojiPicker.open
    ? editablePlainCursor.plain.slice(emojiPicker.start + 1, editablePlainCursor.cursor).replace(/\s/g, " ")
    : "";
  const emojiFiltered = filterEmojiByPrefix(emojiQuery);

  const insertEmoji = useCallback((emoji: string) => {
    const el = inputEditableRef.current;
    if (!el || !emojiPicker.open) return;
    const start = emojiPicker.start;
    const end = getEditableCursorOffset(el);
    const range = getEditableRangeByOffsets(el, start, end);
    if (!range) return;
    range.deleteContents();
    range.insertNode(document.createTextNode(emoji));
    range.collapse(false);
    const md = htmlToMarkdown(el.innerHTML);
    setInput(md);
    pushUndoState(md);
    setEmojiPicker({ open: false, start: 0, selectedIndex: 0 });
    setTimeout(() => {
      el.focus();
      setEditableCursorOffset(el, start + emoji.length);
    }, 0);
  }, [emojiPicker.open, emojiPicker.start, pushUndoState]);

  const insertMention = useCallback((mentionText: string) => {
    const el = inputEditableRef.current;
    if (!el || !mentionPicker.open) return;
    const start = mentionPicker.start;
    const end = getEditableCursorOffset(el);
    const range = getEditableRangeByOffsets(el, start, end);
    if (!range) return;
    const replacement = `@${mentionText} `;
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    range.collapse(false);
    const md = htmlToMarkdown(el.innerHTML);
    setInput(md);
    pushUndoState(md);
    setMentionPicker({ open: false, start: 0, selectedIndex: 0 });
    setTimeout(() => {
      el.focus();
      setEditableCursorOffset(el, start + replacement.length);
    }, 0);
  }, [mentionPicker.open, mentionPicker.start, pushUndoState]);

  const getInputMarkdown = useCallback(
    () => (inputEditableRef.current ? htmlToMarkdown(inputEditableRef.current.innerHTML) : ""),
    []
  );

  /* ---------- Draft per chat (Telegram-like) ---------- */
  const DRAFT_LS_PREFIX = "pingy_draft_v1:";
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraftConversationIdRef = useRef<string | null>(null);

  const saveDraftNow = useCallback((cid: string, md: string) => {
    if (typeof localStorage === "undefined") return;
    const key = `${DRAFT_LS_PREFIX}${cid}`;
    const trimmed = (md || "").replace(/\u00a0/g, " ").trimEnd();
    if (!trimmed) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    try { localStorage.setItem(key, trimmed); } catch { /* ignore */ }
  }, []);

  const scheduleDraftSave = useCallback((cid: string, md: string) => {
    if (!cid) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      saveDraftNow(cid, md);
    }, 250);
  }, [saveDraftNow]);

  const loadDraft = useCallback((cid: string): string => {
    if (typeof localStorage === "undefined") return "";
    try { return localStorage.getItem(`${DRAFT_LS_PREFIX}${cid}`) || ""; } catch { return ""; }
  }, []);

  // Save previous chat draft on switch; restore current chat draft on entry. Only run when conversationId changes, not on every keystroke.
  useEffect(() => {
    if (!conversationId) return;
    const prev = lastDraftConversationIdRef.current;
    if (prev && prev !== conversationId) {
      saveDraftNow(prev, getInputMarkdown());
    }
    lastDraftConversationIdRef.current = conversationId;
    const draft = loadDraft(conversationId);
    if (draft) {
      setInputAndEditable(draft);
      resetUndoStack();
    } else {
      // Clear when switching to a chat that has no draft (don't carry text from previous chat).
      setInputAndEditable("");
      resetUndoStack();
    }
  }, [conversationId, getInputMarkdown, loadDraft, resetUndoStack, saveDraftNow, setInputAndEditable]);

  // On unmount, persist current draft.
  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      if (conversationId) saveDraftNow(conversationId, getInputMarkdown());
    };
  }, [conversationId, getInputMarkdown, saveDraftNow]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionPicker.open) {
      if (e.key === "Escape") {
        setMentionPicker((p) => ({ ...p, open: false }));
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionPicker((p) => ({ ...p, selectedIndex: Math.min(mentionFiltered.length - 1, p.selectedIndex + 1) }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionPicker((p) => ({ ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) }));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && mentionFiltered.length > 0) {
        e.preventDefault();
        const idx = Math.min(mentionPicker.selectedIndex, mentionFiltered.length - 1);
        const m = mentionFiltered[idx];
        const u = m.user as User;
        const mentionText = u.username || u.display_name || u.phone || u.id;
        insertMention(mentionText);
        return;
      }
    }
    if (emojiPicker.open) {
      if (e.key === "Escape") {
        setEmojiPicker((p) => ({ ...p, open: false }));
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setEmojiPicker((p) => ({ ...p, selectedIndex: Math.min(emojiFiltered.length - 1, p.selectedIndex + 1) }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setEmojiPicker((p) => ({ ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) }));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && emojiFiltered.length > 0) {
        e.preventDefault();
        const idx = Math.min(emojiPicker.selectedIndex, emojiFiltered.length - 1);
        insertEmoji(emojiFiltered[idx].emoji);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (pendingFilesForPreview?.length && filePreviewConfirmRef.current) {
        filePreviewConfirmRef.current();
        return;
      }
      const form = (e.target as HTMLElement).closest("form");
      if (form) form.requestSubmit();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        if (undoIndexRef.current < undoStackRef.current.length - 1) {
          undoIndexRef.current++;
          setInputAndEditable(undoStackRef.current[undoIndexRef.current]);
        }
      } else {
        if (undoIndexRef.current > 0) {
          undoIndexRef.current--;
          setInputAndEditable(undoStackRef.current[undoIndexRef.current]);
        }
      }
      return;
    }
    if (ctrl && e.key === "y") {
      e.preventDefault();
      if (undoIndexRef.current < undoStackRef.current.length - 1) {
        undoIndexRef.current++;
        setInputAndEditable(undoStackRef.current[undoIndexRef.current]);
      }
      return;
    }
    if (ctrl && e.key === "b") {
      e.preventDefault();
      applyFormatShortcut("bold");
      return;
    }
    if (ctrl && e.key === "i") {
      e.preventDefault();
      applyFormatShortcut("italic");
      return;
    }
    if (ctrl && e.key === "k") {
      e.preventDefault();
      const url = window.prompt(t("chat.enterUrl"), "https://");
      if (url != null) applyFormatShortcut("createLink", url);
      return;
    }
    if (ctrl && e.shiftKey && e.key === "X") {
      e.preventDefault();
      applyFormatShortcut("strikeThrough");
      return;
    }
    // Ctrl+T — toggle keyboard layout EN↔RU
    if (ctrl && e.key === "t") {
      e.preventDefault();
      handleSwitchLayout();
      return;
    }
  }, [applyFormatShortcut, setInputAndEditable, handleSwitchLayout, mentionPicker, mentionFiltered, insertMention, emojiPicker, emojiFiltered, insertEmoji, pendingFilesForPreview]);

  /* ---------- Auto-resize input height: 1 line → up to 8 lines, then inner scroll ---------- */
  const INPUT_LINE_HEIGHT_PX = 24;
  const INPUT_MAX_LINES = 8;
  const INPUT_MAX_HEIGHT_PX = INPUT_LINE_HEIGHT_PX * INPUT_MAX_LINES + 16; // + padding
  useEffect(() => {
    const el = inputEditableRef.current;
    if (!el) return;
    el.style.height = "0";
    const h = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT_PX);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [input]);

  /* ---------- Mark as read ---------- */
  const markRead = useCallback(() => {
    if (!chatId) return;
    chatsApi.markRead(chatId).catch(() => {});
    useChatListStore.getState().setUnread(chatId, 0);
    // Also notify via notification WS
    notifMgrRef.current?.send({ type: "mark_read", chat_id: chatId });
  }, [chatId]);

  /* ---------- Reset unread state when switching chat ---------- */
  useEffect(() => {
    if (!chatId) return;
    setInitialUnreadIds([]);
    setSeenBottomIds(new Set());
    setUnreadLineDismissed(false);
    sentinelRefs.current.clear();
    rowHeightsRef.current.clear();
    setVirtualMeasureTick((v) => v + 1);
    setMessagesScrollTop(0);
  }, [chatId]);

  useLayoutEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const update = () => setMessagesViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = chatAreaRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setChatAreaWidth(rect.width);
      setChatAreaBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);

  useEffect(() => {
    const active = new Set(messages.map((m) => m.id));
    let changed = false;
    rowHeightsRef.current.forEach((_, id) => {
      if (!active.has(id)) {
        rowHeightsRef.current.delete(id);
        changed = true;
      }
    });
    if (changed) setVirtualMeasureTick((v) => v + 1);
  }, [messages]);

  /* ---------- Load data ---------- */
  useEffect(() => {
    const id = conversationId;
    if (!id || !token) return;
    setLoading(true);

    if (channelId) {
      /* Channel: load channel + posts */
      channelsApi.get(channelId).then((channelRes) => {
        const ch = channelRes.data;
        setChannelRaw(ch);
        setChat(channelToChat(ch));
        channelPostsApi.list(channelId, { limit: 10 }).then((res) => {
          const msgs = res.data.map((p) => channelPostToMessage(p, channelId, ch));
        useMessagesStore.setState((s) => ({
          byChat: { ...s.byChat, [channelId]: msgs },
          hasMoreByChat: { ...s.hasMoreByChat, [channelId]: res.hasMore },
        }));
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottomInstant()));
        }).catch(() => {});
      }).catch(() => { setChannelRaw(null); setChat(null); }).finally(() => setLoading(false));

      setMembers([]); // Channels don't use members list the same way
      return;
    }

    /* Chat: load chat + messages */
    setChannelRaw(null);
    const chatP = chatsApi.get(chatId!).then((res) => {
      setChat(res.data);
      setIsMuted(res.data.is_muted);
      // Initialize online status from other_member if available
      if (res.data.is_personal && res.data.other_member) {
        const om = res.data.other_member;
        setOnlineStatus((prev) => ({
          ...prev,
          [om.id]: { is_online: !!om.is_online, last_seen_display: om.last_seen_display },
        }));
      }
      return res.data;
    }).catch(() => { setChat(null); return null; }).finally(() => setLoading(false));
    const msgsP = storeLoadMessages(chatId!);

    // Decrypt API-loaded encrypted messages (PreKey first, then Whisper)
    msgsP.then(async (loadedMsgs) => {
      if (!loadedMsgs || loadedMsgs.length === 0) return;
      const myDeviceId = await e2eeKeyStorage.getCurrentDeviceId();
      if (myDeviceId == null) return;

      // Process in chronological order so PreKey messages establish sessions first
      const encrypted = loadedMsgs
        .filter((m: Message) => m.is_encrypted && (m as unknown as Record<string, unknown>).encrypted_keys)
        .filter((m: Message) => m.content === "Зашифрованное сообщение" || m.content === t("common.encryptedMessage"));

      if (encrypted.length === 0) return;

      // Sort chronologically (oldest first) to ensure PreKey messages establish sessions before Whisper messages
      const sorted = [...encrypted].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const msg of sorted) {
        const encKeys = (msg as unknown as Record<string, unknown>).encrypted_keys as Record<string, { type: number; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number }>;
        const myEntry = encKeys?.[String(myDeviceId)];
        if (!myEntry) continue;

        const senderId = getSenderId(msg);
        const senderDeviceId = ((msg as unknown as Record<string, unknown>).sender_device_id as number) ?? 0;

        try {
          const decrypted = await decryptFromDevice(
            senderId,
            senderDeviceId,
            myEntry.type as 0 | 1,
            myEntry.body,
            myEntry.type === 0 ? { identity_key: myEntry.identity_key!, ephemeral_key: myEntry.ephemeral_key!, spk_id: myEntry.spk_id!, opk_id: myEntry.opk_id } : undefined
          );
          storeUpsertMessage(chatId!, { ...msg, content: decrypted });
        } catch (err) {
          // Decryption failed for this message — skip silently
        }
      }
    }).catch(() => {});

    // Wait for both chat metadata and messages before deciding scroll target
    Promise.all([chatP, msgsP]).then(([chatData, msgs]) => {
      const unread = chatData?.unread_count ?? 0;
      if (unread > 0 && msgs && msgs.length > 0) {
        // Set initialUnreadIds BEFORE scroll so the divider renders in the same frame
        const clampedUnread = Math.min(unread, msgs.length);
        const ids = msgs.slice(-clampedUnread).map((m: { id: string }) => m.id);
        setInitialUnreadIds(ids);
        // Wait for React to render the divider, then scroll to it
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const divider = document.querySelector('[data-unread-line]');
          if (divider) {
            divider.scrollIntoView({ block: 'start' });
            // Small upward nudge for visual breathing room
            if (messagesScrollRef.current) messagesScrollRef.current.scrollTop -= 12;
          } else {
            scrollToBottomInstant();
          }
        }));
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottomInstant()));
      }
    });

    chatsApi.members(chatId!).then((res) => {
      setMembers(res.data);
      // Initialize online status from members
      const statusMap: Record<string, { is_online: boolean; last_seen_display?: string | null }> = {};
      for (const m of res.data) {
        if (m.user?.is_online !== undefined) {
          statusMap[m.user.id] = { is_online: !!m.user.is_online, last_seen_display: m.user.last_seen_display };
        }
      }
      if (Object.keys(statusMap).length > 0) {
        setOnlineStatus((prev) => ({ ...prev, ...statusMap }));
      }
    }).catch(() => {});
  }, [chatId, channelId, conversationId, token, scrollToBottomInstant]);

  const refreshChat = useCallback(() => {
    if (!chatId) return;
    chatsApi.get(chatId).then((res) => {
      setChat(res.data);
      onChatUpdated?.(res.data);
    });
  }, [chatId, onChatUpdated]);

  /* ---------- Auto-focus message input when chat loads ---------- */
  useEffect(() => {
    if (!loading && chat && inputEditableRef.current) {
      // Small delay to let the DOM settle after render
      requestAnimationFrame(() => {
        inputEditableRef.current?.focus();
      });
    }
  }, [loading, chat]);

  const canInviteToGroup = chat && !chat.is_personal && (chat.owner?.id === myUserId || members.some((m) => m.user.id === myUserId && m.role === "admin"));

  // --- Message search ---
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim() || !chatId) {
      setSearchResults([]); setSearchTotal(0); setSearchIdx(0);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        if (chat?.is_secret) {
          const allMsgs = useMessagesStore.getState().byChat[chatId] ?? [];
          const matched = rankSecretChatMessages(allMsgs, searchQuery.trim());
          setSearchResults(matched); setSearchTotal(matched.length); setSearchIdx(0);
        } else {
          const { data } = await chatsApi.searchMessages(chatId, searchQuery.trim(), { limit: 50 });
          setSearchResults(data.results); setSearchTotal(data.total); setSearchIdx(0);
        }
      } catch { setSearchResults([]); setSearchTotal(0); } finally { setSearchLoading(false); }
    }, 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery, searchOpen, chatId, chat?.is_secret]);

  useEffect(() => {
    if (!searchOpen || searchResults.length === 0) return;
    const msg = searchResults[searchIdx];
    if (!msg) return;
    const el = document.querySelector(`[data-msg-wrapper="${msg.id}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blue-400", "rounded-lg");
      const timer = setTimeout(() => el.classList.remove("ring-2", "ring-blue-400", "rounded-lg"), 2000);
      return () => clearTimeout(timer);
    }
  }, [searchIdx, searchResults, searchOpen]);

  useEffect(() => {
    const raw = inviteSearchQuery.trim();
    const usernameOnly = raw.startsWith("@");
    const q = usernameOnly ? raw.slice(1).trim() : raw;
    if (!q) {
      setInviteSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      setInviteSearchLoading(true);
      authApi
        .searchUsers(q)
        .then((res) => {
          const list = res.data.results || [];
          if (!usernameOnly) {
            setInviteSearchResults(list);
            return;
          }
          const ql = q.toLowerCase();
          setInviteSearchResults(list.filter((u) => (u.username || "").toLowerCase().startsWith(ql)));
        })
        .catch(() => setInviteSearchResults([]))
        .finally(() => setInviteSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [inviteSearchQuery]);

  /* ---------- Capture the unread list on first availability of chat and messages ---------- */
  useEffect(() => {
    if (!chat || messages.length === 0) return;
    const n = chat.unread_count ?? 0;
    if (n > 0 && initialUnreadIds.length === 0) {
      setInitialUnreadIds(messages.slice(-n).map((m) => m.id));
    }
  }, [chat, messages, chat?.unread_count, initialUnreadIds.length]);

  /* ---------- Intersection Observer: message bottom in viewport = read ---------- */
  useEffect(() => {
    const root = messagesScrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setSeenBottomIds((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            if (e.isIntersecting) {
              const id = (e.target as HTMLDivElement).dataset.messageId;
              if (id) next.add(id);
            }
          }
          return next;
        });
      },
      { root, threshold: 0, rootMargin: "0px" }
    );
    const map = sentinelRefs.current;
    map.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
    };
  }, [messages]);

  /* ---------- All unread messages seen (bottom in viewport) → markRead and hide the line ---------- */
  useEffect(() => {
    if (initialUnreadIds.length === 0 || unreadLineDismissed) return;
    const allSeen = initialUnreadIds.every((id) => seenBottomIds.has(id));
    if (allSeen) {
      markRead();
      setUnreadLineDismissed(true);
    }
  }, [initialUnreadIds, seenBottomIds, unreadLineDismissed, markRead]);

  const refreshScheduled = useCallback(() => {
    if (!chatId) return;
    scheduledApi.list(chatId).then((res) => setScheduledList(res.data)).catch(() => setScheduledList([]));
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !token) return;
    refreshScheduled();
  }, [chatId, token, refreshScheduled]);

  /* ---------- Close schedule context menu on click outside ---------- */
  useEffect(() => {
    if (!scheduleMenuPos) return;
    const close = () => setScheduleMenuPos(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [scheduleMenuPos]);

  /* ---------- Close attach menu on click outside ---------- */
  useEffect(() => {
    if (!showAttachMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (!attachMenuRef.current?.contains(e.target as Node)) setShowAttachMenu(false);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showAttachMenu]);

  /* ---------- Close sticker-gif picker on click outside ---------- */
  useEffect(() => {
    if (!showStickerGifPanel) return;
    const handleClick = (e: MouseEvent) => {
      const inStickerGif = stickerGifPickerRef.current?.contains(e.target as Node);
      if (!inStickerGif) {
        setShowStickerGifPanel(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showStickerGifPanel]);

  /* ---------- Close info (three-dots) menu on click outside ---------- */
  useEffect(() => {
    if (!showInfoMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (infoMenuRef.current?.contains(e.target as Node)) return;
      if (muteFlyoutRef.current?.contains(e.target as Node)) return;
      setShowInfoMenu(false);
      if (muteFlyoutCloseTimerRef.current) {
        clearTimeout(muteFlyoutCloseTimerRef.current);
        muteFlyoutCloseTimerRef.current = null;
      }
      setShowMuteFlyout(false);
      setMuteFlyoutPos(null);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showInfoMenu]);

  /* ---------- Fetch contacts when viewing profile or chat info (for "add to contacts" state) ---------- */
  useEffect(() => {
    if (infoUserId || (showInfo && chat?.is_personal)) {
      contactsApi.list().then((r) => setContacts(r.data)).catch(() => setContacts([]));
    }
  }, [infoUserId, showInfo, chat?.is_personal]);

  useEffect(() => {
    if (showInfoMenu) return;
    if (muteFlyoutCloseTimerRef.current) {
      clearTimeout(muteFlyoutCloseTimerRef.current);
      muteFlyoutCloseTimerRef.current = null;
    }
    setShowMuteFlyout(false);
    setMuteFlyoutPos(null);
  }, [showInfoMenu]);

  useEffect(() => () => {
    if (muteFlyoutCloseTimerRef.current) {
      clearTimeout(muteFlyoutCloseTimerRef.current);
      muteFlyoutCloseTimerRef.current = null;
    }
  }, []);

  /* ---------- Close avatar fullscreen on Escape ---------- */
  useEffect(() => {
    if (!showAvatarFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAvatarFullscreen(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showAvatarFullscreen]);

  /* ---------- Mark as read when window gets focus ---------- */
  useEffect(() => {
    const handleFocus = () => markRead();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [markRead]);

  /* ---------- Chat WebSocket (with auto-reconnect + delta sync) ---------- */
  const chatWsRef = useRef<WsManager | null>(null);
  /* Stable refs for callbacks inside WS effect — prevents reconnect on re-render */
  const scrollToBottomRef = useRef(scrollToBottom);  scrollToBottomRef.current = scrollToBottom;
  const markReadRef = useRef(markRead);              markReadRef.current = markRead;
  const isScrolledToBottomRef = useRef(isScrolledToBottom); isScrolledToBottomRef.current = isScrolledToBottom;
  const onMessageSentRef = useRef(onMessageSent);    onMessageSentRef.current = onMessageSent;
  const storeUpsertMessageRef = useRef(storeUpsertMessage); storeUpsertMessageRef.current = storeUpsertMessage;
  const storeUpdateMessageRef = useRef(storeUpdateMessage); storeUpdateMessageRef.current = storeUpdateMessage;
  useEffect(() => {
    if (!chatId || !token || channelId) return; // No WebSocket for channels
    const wsUrl = buildWsUrl(`/ws/chat/${chatId}/`);
    const mgr = new WsManager({
      url: wsUrl,
      protocols: ["bearer", token],
      onOpen: () => {
        // On reconnect, delta-sync messages since last known
        const meta = db.syncMeta.get(chatId);
        if (meta) {
          meta.then((m) => {
            if (m?.lastMessageAt) {
              messagesApi.list(chatId, { since: m.lastMessageAt }).then(async (res) => {
                const freshMsgs = (res.data).map(storeNormalizeMessage);
                const existingMsgs = useMessagesStore.getState().byChat[chatId] ?? [];
                const existingMap = new Map(existingMsgs.map((em) => [em.id, em]));
                const toDecrypt: Message[] = [];
                for (const msg of freshMsgs) {
                  if (msg.is_encrypted) {
                    if (existingMap.has(msg.id)) {
                      storeUpsertMessageRef.current(chatId, { ...msg, content: existingMap.get(msg.id)!.content });
                    } else {
                      storeUpsertMessageRef.current(chatId, { ...msg, content: t("common.encryptedMessage") });
                      toDecrypt.push(msg);
                    }
                  } else {
                    storeUpsertMessageRef.current(chatId, msg);
                  }
                }
                // Decrypt new encrypted messages from delta-sync
                if (toDecrypt.length > 0) {
                  const myDevId = await e2eeKeyStorage.getCurrentDeviceId();
                  if (myDevId != null) {
                    const chronological = toDecrypt.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                    for (const msg of chronological) {
                      const ek = (msg as unknown as Record<string, unknown>).encrypted_keys as Record<string, { type: number; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number }>;
                      const entry = ek?.[String(myDevId)];
                      if (!entry) continue;
                      const sid = getSenderId(msg);
                      const sdid = ((msg as unknown as Record<string, unknown>).sender_device_id as number) ?? 0;
                      try {
                        const dec = await decryptFromDevice(sid, sdid, entry.type as 0 | 1, entry.body, entry.type === 0 ? { identity_key: entry.identity_key!, ephemeral_key: entry.ephemeral_key!, spk_id: entry.spk_id!, opk_id: entry.opk_id } : undefined);
                        storeUpsertMessageRef.current(chatId, { ...msg, content: dec });
                      } catch { /* leave placeholder */ }
                    }
                  }
                }
              }).catch(() => {});
            }
          }).catch(() => {});
        }
        // Flush outbox on reconnect
        useOutboxStore.getState().flush().catch(() => {});
      },
    });
    chatWsRef.current = mgr;
    wsRef.current = mgr.raw;

    // Subscribe to WS events
    mgr.on("chat.message", async (data: unknown) => {
      const d = data as { message?: Record<string, unknown> };
      if (!d.message) return;
      let raw = normalizeMediaPayload(d.message);
      const isEncrypted = raw.is_encrypted === true;
      const encryptedKeys = (raw.encrypted_keys as Record<string, { type: number; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number }>) ?? {};
      if (isEncrypted && !(getSenderId(raw as unknown as Message) === myUserId)) {
        const myDeviceId = await e2eeKeyStorage.getCurrentDeviceId();
        const senderId = getSenderId(raw as unknown as Message);
        const senderDeviceId = (raw.sender_device_id as number) ?? 0;
        const myEntry = myDeviceId != null ? encryptedKeys[String(myDeviceId)] : null;
        if (myEntry) {
          try {
            const decrypted = await decryptFromDevice(
              senderId,
              senderDeviceId,
              myEntry.type as 0 | 1,
              myEntry.body,
              myEntry.type === 0 ? { identity_key: myEntry.identity_key!, ephemeral_key: myEntry.ephemeral_key!, spk_id: myEntry.spk_id!, opk_id: myEntry.opk_id } : undefined
            );
            raw = { ...raw, content: decrypted };
          } catch (decErr) {
            raw = { ...raw, content: "[не удалось расшифровать]" };
          }
        } else {
          raw = { ...raw, content: "[нет ключа для этого устройства]" };
        }
      } else if (isEncrypted && getSenderId(raw as unknown as Message) === myUserId) {
        // Look up cached plaintext for our own sent encrypted messages
        const ciphertext = raw.content as string;
        const cachedPlaintext = sentPlaintextCacheRef.current.get(ciphertext);
        if (cachedPlaintext !== undefined) {
          raw = { ...raw, content: cachedPlaintext };
          sentPlaintextCacheRef.current.delete(ciphertext);
        } else {
          raw = { ...raw, content: t("common.encryptedMessage") };
        }
      }
      // Build a proper sender object from flat WS fields so MessageBubble can render avatar
      if (!raw.sender && raw.sender_id) {
        raw = {
          ...raw,
          sender: {
            id: raw.sender_id as string,
            display_name: (raw.sender_display_name as string) || "",
            phone: "",
            avatar: null,
            avatar_url: (raw.sender_avatar_url as string) || null,
            avatar_url_small: (raw.sender_avatar_url_small as string) || null,
          },
        };
      }
      const msg: Message = normalizeMessage({
        ...raw,
        id: raw.id as string,
        created_at: (raw.created_at as string) || new Date().toISOString(),
        reactions: (raw.reactions as Record<string, number>) ?? {},
        my_reactions: (raw.my_reactions as string[]) ?? ((raw as { my_reaction?: string }).my_reaction ? [(raw as { my_reaction: string }).my_reaction] : []),
        read_status: getSenderId(raw as unknown as Message) === myUserId ? ((raw.read_status as string) || "delivered") : undefined,
      } as Message & { my_reaction?: string });
      const isMine = getSenderId(raw as unknown as Message) === myUserId;
      const atBottom = isScrolledToBottomRef.current();
      storeUpsertMessage(chatId, msg);
      if (isMine) onMessageSent?.(chatId, formatMessagePreview(raw as unknown as Message, lang), (raw as { created_at?: string }).created_at);
      if (isMine || atBottom) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToBottomRef.current());
        });
      }
      if (!document.hidden) markRead();
      if (!isMine && !isMutedRef.current) {
        const content = (raw.content as string) || "";
        const me = useAuthStore.getState().user;
        const identifiers = [me?.display_name, me?.username, me?.telegram_username].filter(Boolean) as string[];
        const isMention = identifiers.some((id) => {
          const re = new RegExp(`@${escapeRegex(id)}\\b`, "i");
          return re.test(content);
        });
        playSound(isMention ? "mention" : "receive");
      }
    });

    mgr.on("chat.message.updated", (data: unknown) => {
      const d = data as { message?: Record<string, unknown> };
      if (!d.message) return;
      let raw = normalizeMediaPayload(d.message);
      const mid = raw.id != null ? String(raw.id) : "";
      if (!mid) return;
      if (raw.is_deleted) {
        storeUpdateMessageRef.current(chatId, mid, { is_deleted: true });
      } else {
        // Build a proper sender object from flat WS fields
        if (!raw.sender && raw.sender_id) {
          raw = {
            ...raw,
            sender: {
              id: raw.sender_id as string,
              display_name: (raw.sender_display_name as string) || "",
              phone: "",
              avatar: null,
              avatar_url: (raw.sender_avatar_url as string) || null,
              avatar_url_small: (raw.sender_avatar_url_small as string) || null,
            },
          };
        }
        const updated: Message = storeNormalizeMessage({
          ...raw,
          id: raw.id as string,
          created_at: (raw.created_at as string) || new Date().toISOString(),
          reactions: (raw.reactions as Record<string, number>) ?? {},
          my_reactions: (raw.my_reactions as string[]) ?? ((raw as { my_reaction?: string }).my_reaction ? [(raw as { my_reaction: string }).my_reaction] : []),
          read_status: getSenderId(raw as unknown as Message) === myUserId ? ((raw.read_status as string) || "delivered") : undefined,
        } as Message & { my_reaction?: string });
        storeUpsertMessageRef.current(chatId, updated);
      }
    });

    mgr.on("chat.message.error", (data: unknown) => {
      const d = data as { code?: string; retry_after?: number };
      if (d.code === "slow_mode" && typeof d.retry_after === "number") {
        setUploadError(t("chat.slowModeError").replace("%n", String(d.retry_after)));
        setTimeout(() => setUploadError(""), 5000);
      }
    });

    mgr.on("chat.mark_read", (data: unknown) => {
      const d = data as { last_read_at?: string; user_id?: string };
      if (!d.last_read_at) return;
      const readAt = new Date(d.last_read_at).getTime();
      if (d.user_id !== myUserId) {
        const currentMsgs = useMessagesStore.getState().byChat[chatId] ?? [];
        for (const m of currentMsgs) {
          if (getSenderId(m) !== myUserId) continue;
          if (new Date(m.created_at).getTime() <= readAt && m.read_status !== "read") {
            storeUpdateMessageRef.current(chatId, m.id, { read_status: "read" as const });
          }
        }
        // Also update chat list checkmarks if last message is ours.
        const updateChat = useChatListStore.getState().updateChat;
        updateChat(chatId, { last_message_is_mine: true, last_message_read_status: "read" as const } as Partial<Chat>);
      }
    });

    mgr.on("chat.typing", (data: unknown) => {
      const d = data as { display_name?: string; user_id?: string };
      if (d.user_id && d.user_id === myUserId) return;
      setTyping(d.display_name || d.user_id || null);
      setTimeout(() => setTyping(null), 3000);
    });

    mgr.on("user.online.status", (data: unknown) => {
      const d = data as { user_id?: string; is_online?: boolean; last_seen_display?: string | null };
      if (d.user_id) {
        setOnlineStatus((prev) => ({
          ...prev,
          [d.user_id!]: { is_online: !!d.is_online, last_seen_display: d.last_seen_display },
        }));
        // Also propagate to chat list store so the sidebar green dot updates
        const allChats = useChatListStore.getState().chats;
        const updateChat = useChatListStore.getState().updateChat;
        for (const c of allChats) {
          if (c.is_personal && c.other_member?.id === d.user_id) {
            updateChat(c.id, {
              other_member: { ...c.other_member, is_online: !!d.is_online },
            } as Partial<Chat>);
          }
        }
      }
    });

    mgr.connect();

    return () => {
      chatWsRef.current = null;
      wsRef.current = null;
      mgr.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, token, myUserId]);

  /* ---------- Global notification WebSocket (with auto-reconnect) ---------- */
  const notifMgrRef = useRef<WsManager | null>(null);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  useEffect(() => {
    if (!token) return;
    const wsUrl = buildWsUrl("/ws/notifications/");
    const mgr = new WsManager({
      url: wsUrl,
      protocols: ["bearer", token],
    });
    notifMgrRef.current = mgr;
    notifWsRef.current = mgr.raw;

    // new_message notifications are handled by MessengerPage — not duplicated here.

    mgr.connect();

    return () => {
      notifMgrRef.current = null;
      notifWsRef.current = null;
      mgr.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ---------- Send file (REST) ---------- */
  const showFileTooBig = (name?: string) => {
    setUploadError(name ? t("chat.fileTooLargeNamed").replace("%s", name) : t("chat.fileTooLarge"));
    setTimeout(() => setUploadError(""), 5000);
  };

  /** Cancel an in-flight upload by temp message id (global store removes message and progress). */
  const cancelUpload = useCallback((tempId: string) => {
    useUploadProgressStore.getState().cancelUpload(tempId);
    delete multiUploadLoadedRef.current[tempId];
  }, []);

  /** Send a single file (audio, video, etc.). Optimistic block with upload progress "X/Y Мб", then message for all. */
  const sendFileMessage = async (file: File, msgTypeOverride?: string, caption?: string) => {
    if (!conversationId) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showFileTooBig(file.name);
      return;
    }
    const msgType = msgTypeOverride ?? (
      file.type.startsWith("image/") ? "file"
      : file.type.startsWith("audio/") ? "audio"
      : file.type.startsWith("video/") ? "video"
      : "file"
    );
    const contentToShow = (caption != null && caption.trim() !== "" ? caption.trim() : file.name.trim());
    const tempId = `upload-${crypto.randomUUID()}`;
    const optimisticMsg: Message = {
      id: tempId,
      chat: conversationId,
      sender: {
        id: "self",
        phone: currentUser?.phone ?? "",
        display_name: currentUser?.display_name ?? "",
        avatar: currentUser?.avatar ?? null,
        avatar_url: currentUser?.avatar_url ?? null,
      },
      msg_type: msgType,
      content: contentToShow,
      file: null,
      files: [],
      created_at: new Date().toISOString(),
      edited_at: null,
      is_deleted: false,
      reactions: {},
      my_reactions: [],
      read_status: undefined,
    };
    storeUpsertMessage(conversationId, optimisticMsg);
    setUploadError("");
    scheduleScrollToBottomAfterSend();
    const controller = new AbortController();
    useUploadProgressStore.getState().registerUpload({
      tempId,
      conversationId,
      fileName: file.name,
      total: file.size,
      abortController: controller,
    });
    try {
      const uploadChatId = channelId ? undefined : chatId;
      const uploadRes = await filesApi.upload(file, uploadChatId, false, {
        signal: controller.signal,
        onUploadProgress: (loaded, total) =>
          useUploadProgressStore.getState().updateProgress(tempId, loaded, total || file.size),
        onChunkedUploadId: (id) => useUploadProgressStore.getState().setChunkedUploadId(tempId, id),
      });
      const fileId = uploadRes.data.id;
      const contentToSend = (caption != null && caption.trim() !== "" ? caption.trim() : file.name.trim());
      let durationSeconds: number | undefined;
      if (msgType === "video" || msgType === "video_circle") {
        try {
          const url = URL.createObjectURL(file);
          durationSeconds = await new Promise<number>((resolve) => {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.onloadedmetadata = () => {
              URL.revokeObjectURL(url);
              resolve(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
            };
            video.onerror = () => {
              URL.revokeObjectURL(url);
              resolve(0);
            };
            video.src = url;
          });
          if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) durationSeconds = undefined;
        } catch {
          durationSeconds = undefined;
        }
      } else if (msgType === "audio") {
        try {
          const url = URL.createObjectURL(file);
          durationSeconds = await new Promise<number>((resolve) => {
            const audio = new Audio();
            const cleanup = () => {
              URL.revokeObjectURL(url);
              audio.src = "";
            };
            audio.onloadedmetadata = () => {
              cleanup();
              resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
            };
            audio.onerror = () => {
              cleanup();
              resolve(0);
            };
            audio.src = url;
          });
          if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) durationSeconds = undefined;
        } catch {
          durationSeconds = undefined;
        }
      }
      const msgRes = await createMessage({
        msg_type: msgType,
        content: contentToSend,
        file_id: fileId,
        ...(durationSeconds != null && { duration_seconds: durationSeconds }),
      });
      if (msgRes?.data?.id) {
        const msg = storeNormalizeMessage(msgRes.data);
        storeReplaceTempMessage(conversationId, tempId, msg);
        useUploadProgressStore.getState().unregisterUpload(tempId);
        broadcastMessageCreated(conversationId, msg);
        onMessageSent?.(conversationId, formatMessagePreview(msgRes.data, lang), msgRes.data.created_at);
        if (!sendWithoutSoundRef.current) playSound("send");
      } else {
        storeRemoveMessage(conversationId, tempId);
        useUploadProgressStore.getState().unregisterUpload(tempId);
        setUploadError(t("chat.serverBadResponse"));
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const isCanceled = (err as { name?: string; code?: string })?.name === "Canceled" || (err as { name?: string; code?: string })?.code === "ERR_CANCELED";
      if (isCanceled) return;
      storeRemoveMessage(conversationId, tempId);
      useUploadProgressStore.getState().unregisterUpload(tempId);
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadError");
      setUploadError(msg);
      setTimeout(() => setUploadError(""), 4000);
    }
  };

  /** Send multiple images as a single message (tile layout). Optimistic block with aggregated upload progress. */
  const sendMultiImageMessage = async (imageFiles: File[], caption?: string) => {
    if (!conversationId || imageFiles.length === 0) return;
    const tooBig = imageFiles.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    const totalSize = imageFiles.reduce((s, f) => s + f.size, 0);
    const contentToShow = (caption != null && caption.trim() !== "" ? caption.trim() : imageFiles.map((f) => f.name).join(", "));
    const tempId = `upload-${crypto.randomUUID()}`;
    const optimisticMsg: Message = {
      id: tempId,
      chat: conversationId,
      sender: {
        id: "self",
        phone: currentUser?.phone ?? "",
        display_name: currentUser?.display_name ?? "",
        avatar: currentUser?.avatar ?? null,
        avatar_url: currentUser?.avatar_url ?? null,
      },
      msg_type: "file",
      content: contentToShow,
      file: null,
      files: [],
      created_at: new Date().toISOString(),
      edited_at: null,
      is_deleted: false,
      reactions: {},
      my_reactions: [],
      read_status: undefined,
    };
    storeUpsertMessage(conversationId, optimisticMsg);
    multiUploadLoadedRef.current[tempId] = {};
    setUploadError("");
    scheduleScrollToBottomAfterSend();
    const controller = new AbortController();
    useUploadProgressStore.getState().registerUpload({
      tempId,
      conversationId,
      fileName: imageFiles.map((f) => f.name).join(", "),
      total: totalSize,
      abortController: controller,
    });
    try {
      const uploadTarget = channelId ? undefined : chatId;
      const uploadResults = await Promise.all(
        imageFiles.map((f, i) =>
          filesApi.upload(f, uploadTarget, false, {
            signal: controller.signal,
            onUploadProgress: (loaded) => {
              multiUploadLoadedRef.current[tempId] = multiUploadLoadedRef.current[tempId] || {};
              multiUploadLoadedRef.current[tempId][i] = loaded;
              const sum = Object.values(multiUploadLoadedRef.current[tempId]).reduce((a, b) => a + b, 0);
              useUploadProgressStore.getState().updateProgress(tempId, sum, totalSize);
            },
            onChunkedUploadId: (id) => useUploadProgressStore.getState().setChunkedUploadId(tempId, id),
          })
        )
      );
      const fileIds = uploadResults.map((r) => r.data.id);
      const content = (caption != null && caption.trim() !== "" ? caption.trim() : imageFiles.map((f) => f.name).join(", "));
      const msgRes = await createMessage({ msg_type: "file", content, file_ids: fileIds });
      delete multiUploadLoadedRef.current[tempId];
      if (msgRes?.data?.id) {
        const msg = storeNormalizeMessage(msgRes.data);
        storeReplaceTempMessage(conversationId, tempId, msg);
        useUploadProgressStore.getState().unregisterUpload(tempId);
        broadcastMessageCreated(conversationId, msg);
        onMessageSent?.(conversationId, formatMessagePreview(msgRes.data, lang), msgRes.data.created_at);
        if (!sendWithoutSoundRef.current) playSound("send");
      } else {
        storeRemoveMessage(conversationId, tempId);
        useUploadProgressStore.getState().unregisterUpload(tempId);
        setUploadError(t("chat.serverBadResponse"));
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const isCanceled = (err as { name?: string; code?: string })?.name === "Canceled" || (err as { name?: string; code?: string })?.code === "ERR_CANCELED";
      if (isCanceled) return;
      delete multiUploadLoadedRef.current[tempId];
      storeRemoveMessage(conversationId, tempId);
      useUploadProgressStore.getState().unregisterUpload(tempId);
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadErrorMultiple");
      setUploadError(msg);
      setTimeout(() => setUploadError(""), 4000);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = getInputMarkdown().trim();
    if (text.length > MESSAGE_MAX_LENGTH) return;
    if (editingMessageId && conversationId) {
      if (text) {
        const done = (msg: Message) => {
          storeUpsertMessage(conversationId, storeNormalizeMessage(msg));
          setEditingMessageId(null);
          setInput("");
          if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
        };
        const content = text;
        if (channelId) {
          channelPostsApi.update(channelId, editingMessageId, { content }).then((res) => {
            done(channelPostToMessage(res.data, channelId, channelRaw));
            scheduleScrollToBottomAfterSend();
          });
        } else {
          messagesApi.update(chatId!, editingMessageId, { content }).then((res) => {
            done(res.data);
            scheduleScrollToBottomAfterSend();
          });
        }
      }
    } else {
      sendTextMessage(text);
    }
  };
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setInput("");
    if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
  };
  const handleEmojiSelect = (emoji: string) => {
    const el = inputEditableRef.current;
    if (!el) return;
    pushUndoState(htmlToMarkdown(el.innerHTML));
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (!el.contains(r.commonAncestorContainer)) {
        r.setStart(el, 0);
        r.setEnd(el, 0);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      r.deleteContents();
      r.insertNode(document.createTextNode(emoji));
      r.collapse(false);
    } else {
      el.appendChild(document.createTextNode(emoji));
    }
    const md = htmlToMarkdown(el.innerHTML);
    setInput(md);
    sendTyping();
  };

  /** Send files after confirmation in the preview modal. caption показывается под файлом в чате. */
  const handleFilesPreviewConfirm = async (files: File[], asFileOnly: boolean, caption?: string) => {
    setPendingFilesForPreview(null);
    if (files.length === 0) return;
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    const trimmedCaption = (caption != null && caption.trim() !== "" ? caption.trim() : undefined);
    if (asFileOnly) {
      files.forEach((f) => sendFileMessage(f, "file", trimmedCaption));
      return;
    }
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    const others = files.filter((f) => !f.type.startsWith("image/") && !f.type.startsWith("video/"));
    if (images.length >= 1) {
      const compressed = await Promise.all(images.map((f) => compressImage(f)));
      sendMultiImageMessage(compressed, trimmedCaption);
    }
    videos.forEach((f) => sendFileMessage(f, undefined, trimmedCaption));
    others.forEach((f) => sendFileMessage(f, "file", trimmedCaption));
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = "";
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    setPendingFilesForPreview(files);
    setPendingFilesAsFileOnly(attachAsFileOnlyRef.current);
  };

  const openFileInput = (asFileOnly: boolean) => {
    attachAsFileOnlyRef.current = asFileOnly;
    if (fileInputRef.current) {
      fileInputRef.current.accept = asFileOnly ? "*" : "image/*";
      fileInputRef.current.click();
    }
    setShowAttachMenu(false);
  };

  const handleAttachLocation = () => {
    setShowAttachMenu(false);
    if (!navigator.geolocation) {
      setUploadError(t("chat.locationError"));
      setTimeout(() => setUploadError(""), 5000);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const link = `https://yandex.ru/maps/?pt=${longitude},${latitude}&z=17`;
        sendTextMessage(`📍 ${link}`);
      },
      (err) => {
        const msg = err.code === 1 ? t("chat.locationDenied") : t("chat.locationError");
        setUploadError(msg);
        setTimeout(() => setUploadError(""), 5000);
      },
    );
  };

  const handleShareContact = (contact: Contact) => {
    setShowContactPickerModal(false);
    const u = contact.contact_user;
    const name = contact.local_name || userDisplayName(u);
    const link = `${window.location.origin}/chats?write=${encodeURIComponent((u as User).username || u.id)}`;
    sendTextMessage(`👤 ${name} — ${link}`);
  };

  /* ---------- Drag & drop ---------- */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
      setDropZone(null);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!chatAreaRef.current) return;
    const rect = chatAreaRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const half = rect.height / 2;
    setDropZone(y < half ? "top" : "bottom");
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    const zone = dropZone;
    setDropZone(null);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      setUploadError(t("chat.fileTooLargeNamed").replace("%s", tooBig.name));
      setTimeout(() => setUploadError(""), 5000);
      return;
    }
    setPendingFilesForPreview(files);
    setPendingFilesAsFileOnly(zone === "top");
  };

  /** Paste: handle pasting images from clipboard, everything else — default behavior */
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const files = Array.from(items)
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    setPendingFilesForPreview(files);
    setPendingFilesAsFileOnly(false);
  };

  const sendTyping = () => {
    chatWsRef.current?.send({ type: "chat.typing" });
  };

  /* ---------- Mute (duration: 1h, 3h, 8h, forever, off) ---------- */
  const handleMute = async (duration: "1h" | "3h" | "8h" | "forever" | "off") => {
    if (!chatId) return;
    setMuteLoading(true);
    try {
      const { data } = await chatsApi.muteChat(chatId, duration);
      setIsMuted(data.is_muted);
      if (chat) setChat({ ...chat, is_muted: data.is_muted, muted_until: data.muted_until });
      onChatUpdated?.({ id: chatId, is_muted: data.is_muted, muted_until: data.muted_until } as Chat);
    } catch { /* */ }
    finally { setMuteLoading(false); }
  };

  const closeMuteFlyout = useCallback(() => {
    if (muteFlyoutCloseTimerRef.current) {
      clearTimeout(muteFlyoutCloseTimerRef.current);
      muteFlyoutCloseTimerRef.current = null;
    }
    setShowMuteFlyout(false);
    setMuteFlyoutPos(null);
  }, []);

  const openMuteFlyout = useCallback(() => {
    if (!showInfoMenu) return;
    if (muteFlyoutCloseTimerRef.current) {
      clearTimeout(muteFlyoutCloseTimerRef.current);
      muteFlyoutCloseTimerRef.current = null;
    }
    const anchor = muteFlyoutAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const FLYOUT_WIDTH = 168;
    const FLYOUT_HEIGHT = 182;
    const GAP = 6;
    const PAD = 8;
    const canOpenRight = rect.right + GAP + FLYOUT_WIDTH <= window.innerWidth - PAD;
    const left = canOpenRight
      ? rect.right + GAP
      : Math.max(PAD, rect.left - FLYOUT_WIDTH - GAP);
    const top = Math.max(PAD, Math.min(rect.top, window.innerHeight - FLYOUT_HEIGHT - PAD));
    setMuteFlyoutPos({ left, top });
    setShowMuteFlyout(true);
  }, [showInfoMenu]);

  const scheduleCloseMuteFlyout = useCallback(() => {
    if (muteFlyoutCloseTimerRef.current) {
      clearTimeout(muteFlyoutCloseTimerRef.current);
    }
    muteFlyoutCloseTimerRef.current = setTimeout(() => {
      setShowMuteFlyout(false);
      setMuteFlyoutPos(null);
    }, 120);
  }, []);

  /* ---------- Chat info editing ---------- */
  const handleSaveDescription = async () => {
    if (!chatId || !chat) return;
    setSavingChat(true);
    try {
      const cleanedDescription = descriptionDraft.replace(/\n{2,}/g, "\n").trim().slice(0, 100);
      const { data: updated } = await chatsApi.update(chatId, { description: cleanedDescription });
      setChat({ ...chat, description: updated.description });
      setEditingDescription(false);
    } catch { /* ignore */ } finally { setSavingChat(false); }
  };

  const handleSlowModeChange = async (seconds: number) => {
    if (!chatId || !chat || chat.owner?.id !== myUserId) return;
    setSavingChat(true);
    try {
      const { data: updated } = await chatsApi.update(chatId, { slow_mode_seconds: seconds });
      setChat({ ...chat, slow_mode_seconds: updated.slow_mode_seconds ?? 0 });
      onChatUpdated?.({ ...chat, slow_mode_seconds: updated.slow_mode_seconds ?? 0 } as Chat);
    } catch { /* ignore */ } finally { setSavingChat(false); }
  };

  const handleSaveTitle = async () => {
    if (!chatId || !chat || !titleDraft.trim()) return;
    setSavingChat(true);
    try {
      const { data: updated } = await chatsApi.update(chatId, { title: titleDraft.trim() });
      const next = { ...chat, title: updated.title };
      setChat(next);
      onChatUpdated?.(next);
      setEditingTitle(false);
    } catch { /* ignore */ } finally { setSavingChat(false); }
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId || !chat) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(t("chat.avatarTooLarge"));
      setTimeout(() => setUploadError(""), 5000);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }
    setPendingAvatarFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const handleAvatarCropConfirm = async (blob: Blob) => {
    if (!chatId || !chat) return;
    const file = new File([blob], "avatar.png", { type: "image/png" });
    setPendingAvatarFile(null);
    setAvatarUploading(true);
    try {
      const { data: updated } = await chatsApi.uploadAvatar(chatId, file);
      const next = { ...chat, avatar_url: updated.avatar_url };
      setChat(next);
      onChatUpdated?.(next);
      setEditingAvatar(false);
    } catch { /* ignore */ } finally { setAvatarUploading(false); }
  };

  const handleRemoveAvatar = async () => {
    if (!chatId || !chat) return;
    setAvatarUploading(true);
    try {
      const { data: updated } = await chatsApi.removeAvatar(chatId);
      const next = { ...chat, avatar_url: updated.avatar_url };
      setChat(next);
      onChatUpdated?.(next);
      setEditingAvatar(false);
    } catch { /* ignore */ } finally { setAvatarUploading(false); }
  };

  const handleAvatarSaveFromEditor = async (blob: Blob) => {
    if (!chatId || !chat) return;
    const file = new File([blob], "avatar.png", { type: "image/png" });
    setAvatarUploading(true);
    try {
      const { data: updated } = await chatsApi.uploadAvatar(chatId, file);
      const next = { ...chat, avatar_url: updated.avatar_url };
      setChat(next);
      onChatUpdated?.(next);
      setShowAvatarEditor(false);
      setEditingAvatar(false);
    } catch { /* ignore */ } finally { setAvatarUploading(false); }
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId || !chat) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(t("chat.bgTooLarge"));
      setTimeout(() => setUploadError(""), 5000);
      if (backgroundInputRef.current) backgroundInputRef.current.value = "";
      return;
    }
    setBackgroundUploading(true);
    try {
      const { data: updated } = await chatsApi.uploadBackground(chatId, file);
      const next = { ...chat, background_url: updated.background_url };
      setChat(next);
      onChatUpdated?.(next);
    } catch { /* ignore */ } finally { setBackgroundUploading(false); }
    if (backgroundInputRef.current) backgroundInputRef.current.value = "";
  };

  const handleApproveMember = (memberId: string) => {
    if (!chatId) return;
    setApproveRejectLoading(memberId);
    chatsApi
      .approve(chatId, memberId)
      .then(() => { refreshChat(); chatsApi.members(chatId).then((res) => setMembers(res.data)).catch(() => {}); })
      .catch(() => {})
      .finally(() => setApproveRejectLoading(null));
  };

  const handleRejectMember = (memberId: string) => {
    if (!chatId) return;
    setApproveRejectLoading(memberId);
    chatsApi
      .reject(chatId, memberId)
      .then(() => { refreshChat(); chatsApi.members(chatId).then((res) => setMembers(res.data)).catch(() => {}); })
      .catch(() => {})
      .finally(() => setApproveRejectLoading(null));
  };

  const handleInviteUser = (userId: string) => {
    if (!chatId) return;
    setInviteLoading(true);
    setInviteError("");
    chatsApi
      .invite(chatId, { user_id: userId })
      .then(() => {
        refreshChat();
        chatsApi.members(chatId).then((r) => setMembers(r.data)).catch(() => {});
        setInviteSearchQuery("");
        setInviteSearchResults([]);
      })
      .catch((err: { response?: { status?: number; data?: { detail?: string } } }) => {
        setInviteError(err?.response?.data?.detail || t("chat.inviteError"));
      })
      .finally(() => setInviteLoading(false));
  };

  const doLeaveChat = () => {
    if (!chatId) return;
    setLeaveLoading(true);
    setLeaveError("");
    chatsApi
      .leave(chatId)
      .then(() => { onChatLeft?.(chatId); onBack?.(); })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        setLeaveError(e?.response?.data?.detail || t("chat.leaveError"));
      })
      .finally(() => setLeaveLoading(false));
  };

  const doDeleteChat = () => {
    if (!chatId) return;
    setDeleteLoading(true);
    setDeleteError("");
    chatsApi
      .delete(chatId)
      .then(() => { onChatLeft?.(chatId); onBack?.(); })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        setDeleteError(e?.response?.data?.detail || t("chat.deleteError"));
      })
      .finally(() => setDeleteLoading(false));
  };

  const handleLeaveChat = () => {
    if (chatId) setConfirmAction("leave");
  };

  const handleDeleteChat = () => {
    if (chatId) setConfirmAction("delete");
  };

  const handleConfirmAction = () => {
    if (confirmAction === "leave") doLeaveChat();
    else if (confirmAction === "delete") doDeleteChat();
    setConfirmAction(null);
  };

  /* ---------- Voice recording: visualization + amplitude sampling ---------- */
  const WAVEFORM_BARS = 64;
  const LIVE_BARS = 32;
  const SAMPLE_INTERVAL_MS = 80;

  const startRecording = async () => {
    try {
      if (navigator.permissions) {
        const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (perm.state === "denied") {
          setUploadError(t("chat.micAccessDenied"));
          setTimeout(() => setUploadError(""), 5000);
          return;
        }
      }
    } catch { /* permissions API not supported, proceed */ }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      amplitudeSamplesRef.current = [];
      setLiveWaveform(Array(LIVE_BARS).fill(0));
      setVoiceLevel(0);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.smoothingTimeConstant = 0.5;

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(dataArray);
        const step = Math.floor(dataArray.length / LIVE_BARS);
        const bars: number[] = [];
        let levelSum = 0;
        for (let i = 0; i < LIVE_BARS; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += Math.abs(dataArray[i * step + j] - 128);
          const v = Math.min(255, (sum / step) * 2);
          bars.push(v);
          levelSum += v;
        }
        setLiveWaveform(bars);
        setVoiceLevel(Math.min(255, Math.round(levelSum / LIVE_BARS)));
        waveformRafRef.current = requestAnimationFrame(tick);
      };
      waveformRafRef.current = requestAnimationFrame(tick);

      sampleIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += Math.abs(dataArray[i] - 128);
        const avg = (sum / dataArray.length) * 2;
        amplitudeSamplesRef.current.push(Math.min(255, avg));
      }, SAMPLE_INTERVAL_MS);

      const rec = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setLiveWaveform([]);
        setVoiceLevel(0);
        if (waveformRafRef.current != null) cancelAnimationFrame(waveformRafRef.current);
        waveformRafRef.current = null;
        if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
        sampleIntervalRef.current = null;
        audioContextRef.current?.close();
        audioContextRef.current = null;
        analyserRef.current = null;

        if (audioChunksRef.current.length === 0) return;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const ext = mimeType.includes("webm") ? "webm" : "mp4";
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setUploadError(t("chat.voiceTooLarge"));
          setTimeout(() => setUploadError(""), 5000);
          return;
        }

        const samples = amplitudeSamplesRef.current;
        let waveform: number[] = [];
        if (samples.length > 0) {
          const target = WAVEFORM_BARS;
          const bucketSize = samples.length / target;
          const out: number[] = [];
          for (let i = 0; i < target; i++) {
            const start = Math.floor(i * bucketSize);
            const end = Math.floor((i + 1) * bucketSize);
            let max = 0;
            for (let j = start; j < end && j < samples.length; j++) if (samples[j] > max) max = samples[j];
            out.push(Math.round(max));
          }
          const maxVal = Math.max(...out, 1);
          waveform = out.map((v) => Math.round((v / maxVal) * 255));
        }

        const tempId = `upload-${crypto.randomUUID()}`;
        const optimisticMsg: Message = {
          id: tempId,
          chat: conversationId!,
          sender: {
            id: "self",
            phone: currentUser?.phone ?? "",
            display_name: currentUser?.display_name ?? "",
            avatar: currentUser?.avatar ?? null,
            avatar_url: currentUser?.avatar_url ?? null,
          },
          msg_type: "audio",
          content: file.name,
          file: null,
          files: [],
          created_at: new Date().toISOString(),
          edited_at: null,
          is_deleted: false,
          reactions: {},
          my_reactions: [],
          read_status: undefined,
        };
        storeUpsertMessage(conversationId!, optimisticMsg);
        setUploadError("");
        scheduleScrollToBottomAfterSend();
        const controller = new AbortController();
        useUploadProgressStore.getState().registerUpload({
          tempId,
          conversationId: conversationId!,
          fileName: file.name,
          total: file.size,
          abortController: controller,
        });
        try {
          let durationSeconds: number | undefined;
          try {
            const url = URL.createObjectURL(blob);
            durationSeconds = await new Promise<number>((resolve) => {
              const audio = new Audio();
              const cleanup = () => { URL.revokeObjectURL(url); audio.src = ""; };
              audio.onloadedmetadata = () => { cleanup(); resolve(Number.isFinite(audio.duration) ? audio.duration : 0); };
              audio.onerror = () => { cleanup(); resolve(0); };
              audio.src = url;
            });
            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) durationSeconds = undefined;
          } catch {
            durationSeconds = undefined;
          }
          const uploadTarget = channelId ? undefined : chatId ?? undefined;
          const uploadRes = await filesApi.upload(file, uploadTarget, false, {
            signal: controller.signal,
            onUploadProgress: (loaded, total) =>
              useUploadProgressStore.getState().updateProgress(tempId, loaded, total || file.size),
            onChunkedUploadId: (id) => useUploadProgressStore.getState().setChunkedUploadId(tempId, id),
          });
          const fileId = uploadRes.data.id;
          const msgRes = await createMessage({
            msg_type: "audio",
            content: file.name,
            file_id: fileId,
            waveform: waveform.length > 0 ? waveform : undefined,
            duration_seconds: durationSeconds,
          });
          if (msgRes?.data?.id) {
            const msg = storeNormalizeMessage(msgRes.data);
            storeReplaceTempMessage(conversationId!, tempId, msg);
            useUploadProgressStore.getState().unregisterUpload(tempId);
            broadcastMessageCreated(conversationId!, msg);
            onMessageSent?.(conversationId!, formatMessagePreview(msgRes.data, lang), msgRes.data.created_at);
            if (!sendWithoutSoundRef.current) playSound("send");
          } else {
            storeRemoveMessage(conversationId!, tempId);
            useUploadProgressStore.getState().unregisterUpload(tempId);
            setUploadError(t("chat.serverBadResponse"));
            setTimeout(() => setUploadError(""), 4000);
          }
        } catch (err: unknown) {
          const isCanceled = (err as { name?: string; code?: string })?.name === "Canceled" || (err as { name?: string; code?: string })?.code === "ERR_CANCELED";
          if (!isCanceled) {
            storeRemoveMessage(conversationId!, tempId);
            useUploadProgressStore.getState().unregisterUpload(tempId);
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadError");
            setUploadError(msg);
            setTimeout(() => setUploadError(""), 4000);
          }
        }
      };
      rec.start(250);
      mediaRecorderRef.current = rec;
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      setUploadError(t("chat.micAccessFailed"));
      setTimeout(() => setUploadError(""), 5000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRecordingTime(0);
  };

  const cancelRecording = () => {
    setLiveWaveform([]);
    setVoiceLevel(0);
    if (waveformRafRef.current != null) cancelAnimationFrame(waveformRafRef.current);
    waveformRafRef.current = null;
    if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
    sampleIntervalRef.current = null;
    amplitudeSamplesRef.current = [];
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current!.ondataavailable = null;
      mediaRecorderRef.current!.onstop = null;
      mediaRecorderRef.current!.stop();
      mediaRecorderRef.current!.stream.getTracks().forEach((t) => t.stop());
    }
    audioChunksRef.current = [];
    mediaRecorderRef.current = null;
    setRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRecordingTime(0);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  /* ---------- AI voice input: speech-to-text recognition (Web Speech API) ---------- */
  const getSpeechRecognition = (): SpeechRecognitionCtor | null => {
    if (typeof window === "undefined") return null;
    const w = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  };

  const startAiListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setUploadError(t("chat.speechNotSupported"));
      setTimeout(() => setUploadError(""), 5000);
      return;
    }
    if (speechRecognitionRef.current) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "ru-RU";
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        transcript += (result[0]?.transcript ?? "").trim();
        if (transcript && i < event.results.length - 1) transcript += " ";
      }
      if (!transcript.trim()) return;
      setInput((prev) => {
        const sep = prev.length > 0 && !/[\s\n]$/.test(prev) ? " " : "";
        return prev + sep + transcript;
      });
    };
    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setUploadError(`${t("common.error")}: ${event.error}`);
      setTimeout(() => setUploadError(""), 4000);
      setAiListening(false);
    };
    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setAiListening(false);
    };
    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
      setAiListening(true);
      setUploadError("");
    } catch {
      setUploadError(t("chat.speechStartError"));
      setTimeout(() => setUploadError(""), 5000);
    }
  }, []);

  const stopAiListening = useCallback(() => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort?.();
      } catch { /* ignore */ }
      speechRecognitionRef.current = null;
    }
    setAiListening(false);
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (voiceInputMode === "record") {
      startRecording();
    } else {
      if (aiListening) stopAiListening();
      else startAiListening();
    }
  }, [voiceInputMode, aiListening, startAiListening, stopAiListening]);

  // Переключение голосовой режим (запись аудио ↔ AI транскрипция в поле). Временно отключено — только запись.
  // const toggleVoiceMode = useCallback(() => {
  //   setVoiceInputMode((prev) => {
  //     const next = prev === "ai" ? "record" : "ai";
  //     try {
  //       localStorage.setItem("chat_voice_input_mode", next);
  //     } catch { /* ignore */ }
  //     return next;
  //   });
  //   if (recording) stopRecording();
  //   if (aiListening) stopAiListening();
  // }, [recording, aiListening, stopRecording, stopAiListening]);

  /* ── Long-press handlers (mobile) for send / voice / input ── */
  const lpSendHandlers = useMemo(() => makeLongPressHandlers(lpSendRef, lpSendFiredRef, (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setScheduleMenuPos({ x: rect.left, y: rect.top });
  }), []);

  const lpVoiceHandlers = useMemo(() => makeLongPressHandlers(lpVoiceRef, lpVoiceFiredRef, () => {
    // toggleVoiceMode(); // Временно отключено: переключение на AI-голосовой ввод (речь → текст)
  }), []);

  const lpInputHandlers = useMemo(() => makeLongPressHandlers(lpInputRef, lpInputFiredRef, (e) => {
    const sel = window.getSelection();
    savedFormatRangeRef.current = (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null) ?? null;
    setScheduleMenuPos(null);
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    if (touch) {
      setFormatMenuPos({ x: touch.clientX, y: touch.clientY, start: 0, end: 0 });
    }
  }), []);

  /* ---------- Video recording ---------- */
  const MAX_VIDEO_DURATION = 60; // seconds

  const startVideoRecording = async (mode: "video" | "video_circle") => {
    const isCircle = mode === "video_circle";
    if (isCircle) {
      try {
        const { data } = await paymentsApi.getVideoCircleQuota();
        if (data.remaining !== null && data.remaining <= 0) {
          usePremiumModalStore.getState().openModal();
          return;
        }
      } catch {
        // При ошибке запроса квоты не блокируем — лимит проверит бэкенд при отправке
      }
    }

    try {
      if (navigator.permissions) {
        const camPerm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (camPerm.state === "denied") {
          setUploadError(t("chat.cameraAccessDenied"));
          setTimeout(() => setUploadError(""), 5000);
          return;
        }
      }
    } catch { /* permissions API not supported */ }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: isCircle ? 480 : 640 },
          height: { ideal: isCircle ? 480 : 480 },
        },
        audio: true,
      });
      videoStreamRef.current = stream;
      setVideoRecording(true);
      setVideoRecordingTime(0);

      const mimeType =
        MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus"
        : MediaRecorder.isTypeSupported("video/webm") ? "video/webm"
        : "video/mp4";

      const rec = new MediaRecorder(stream, { mimeType });
      videoChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      rec.onstop = () => {
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach((t) => t.stop());
          videoStreamRef.current = null;
        }
        if (videoChunksRef.current.length === 0) return;
        const blob = new Blob(videoChunksRef.current, { type: mimeType });
        const ext = mimeType.includes("webm") ? "webm" : "mp4";
        const prefix = mode === "video_circle" ? "circle" : "video";
        sendFileMessage(new File([blob], `${prefix}_${Date.now()}.${ext}`, { type: mimeType }), mode);
      };
      rec.start(250);
      videoRecorderRef.current = rec;
      videoTimerRef.current = setInterval(() => setVideoRecordingTime((t) => t + 1), 1000);
    } catch {
      setUploadError(t("chat.cameraAccessFailed"));
      setTimeout(() => setUploadError(""), 5000);
    }
  };

  const stopVideoRecording = () => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoRecorderRef.current?.state !== "inactive") videoRecorderRef.current?.stop();
    videoRecorderRef.current = null;
    setVideoRecording(false);
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    setVideoRecordingTime(0);
  };

  const cancelVideoRecording = () => {
    if (videoRecorderRef.current) {
      videoRecorderRef.current.ondataavailable = null;
      videoRecorderRef.current.onstop = null;
      if (videoRecorderRef.current.state !== "inactive") videoRecorderRef.current.stop();
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    videoChunksRef.current = [];
    videoRecorderRef.current = null;
    setVideoRecording(false);
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    setVideoRecordingTime(0);
  };

  /* Auto-stop video at max duration */
  useEffect(() => {
    if (videoRecording && videoRecordingTime >= MAX_VIDEO_DURATION) {
      stopVideoRecording();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRecording, videoRecordingTime]);

  /* Attach stream to preview element */
  useEffect(() => {
    if (videoRecording && videoPreviewRef.current && videoStreamRef.current) {
      videoPreviewRef.current.srcObject = videoStreamRef.current;
      videoPreviewRef.current.play().catch(() => {});
    }
  }, [videoRecording]);

  /* ---------- Cleanup ---------- */
  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current?.stop();
    }
    if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    if (videoRecorderRef.current?.state !== "inactive") {
      videoRecorderRef.current?.stop();
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
    }
  }, []);

  /* ---------- Loading: show full-page only when no conversation (invalid route). Otherwise show shell and load messages in place. ---------- */
  if (!conversationId || !token) {
    return (
      <div className="chat-thread-shell flex-1 min-h-0 flex items-center justify-center w-full">
        <p className="text-slate-500">{t("common.loading")}</p>
      </div>
    );
  }

  const activeMembers = members.filter((m) => m.status === "active");
  const importModalMembers = activeMembers.map((m) => ({
    user: {
      id: m.user.id,
      display_name: m.user.display_name,
      username: m.user.username ?? undefined,
    },
  }));
  const pendingMembers = members.filter((m) => m.status === "pending");
  const shouldReplaceChatWithInfo = showInfo && chatAreaWidth > 0 && chatAreaWidth < INFO_PANEL_WIDTH_PX * 2;
  const handleCopy = () => {
    if (!chat?.invite_link) return;
    copyToClipboard(normalizeInviteLink(chat.invite_link)).then(() => {
      setInviteCopyShake(true);
      setTimeout(() => setInviteCopyShake(false), 400);
      setCopiedState(true);
      setTimeout(() => setCopiedState(false), 2000);
    });
  };

  return (
    <div className="chat-thread-shell flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
      {/* Single image viewer modal — dimmed overlay + centered image */}
      {/* Forward modal */}
      {showCreatePollModal && chatId && (
        <CreatePollModal
          isOpen={showCreatePollModal}
          onClose={() => setShowCreatePollModal(false)}
          onCreate={handleCreatePoll}
        />
      )}
      {forwardModalMessages && forwardModalMessages.length > 0 && chatId && (
        <ForwardModal
          messages={forwardModalMessages}
          sourceChatId={chatId}
          onClose={() => setForwardModalMessages(null)}
          onForwardComplete={(targetIds) => {
            if (targetIds[0] && onNavigateToChat) onNavigateToChat(targetIds[0]);
            handleExitSelectionMode();
          }}
        />
      )}
      {pendingFilesForPreview && (
        <FilePreviewModal
          files={pendingFilesForPreview}
          onConfirm={(files, caption) => handleFilesPreviewConfirm(files, pendingFilesAsFileOnly, caption)}
          onCancel={() => { setPendingFilesForPreview(null); }}
          confirmRef={filePreviewConfirmRef}
        />
      )}
      {channelId && channelRaw && (
        <ImportTelegramModal
          channelId={channelId}
          channelTitle={channelRaw.title ?? ""}
          isOpen={showImportTelegramModal}
          onClose={() => setShowImportTelegramModal(false)}
          onSuccess={() => {
            channelPostsApi.list(channelId).then((res) => {
              const msgs = res.data.map((p) => channelPostToMessage(p, channelId, channelRaw));
              useMessagesStore.setState((s) => ({
                byChat: { ...s.byChat, [channelId]: msgs },
                hasMoreByChat: { ...s.hasMoreByChat, [channelId]: res.hasMore },
              }));
              requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottomInstant()));
            }).catch(() => {});
          }}
        />
      )}
      {chatId && !channelId && chat && (
        <>
          <ImportTelegramChatModal
            chatId={chatId}
            chatTitle={chat.title ?? ""}
            members={importModalMembers}
            isOpen={showImportTelegramChatModal}
            onClose={() => setShowImportTelegramChatModal(false)}
            onSuccess={() => {
              storeLoadMessages(chatId).then((msgs) => {
                useMessagesStore.setState((s) => ({
                  byChat: { ...s.byChat, [chatId]: msgs },
                }));
                requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottomInstant()));
              });
              setChat((c) => (c ? { ...c, has_telegram_import: true } : c));
              useChatListStore.getState().updateChat(chatId, { has_telegram_import: true });
            }}
          />
          <ManageImportModal
            chatId={chatId}
            chatTitle={chat.title ?? ""}
            members={importModalMembers}
            isOpen={showManageImportModal}
            onClose={() => setShowManageImportModal(false)}
            onSuccess={() => {
              storeLoadMessages(chatId).then((msgs) => {
                useMessagesStore.setState((s) => ({
                  byChat: { ...s.byChat, [chatId]: msgs },
                }));
              });
            }}
          />
        </>
      )}
      <ConfirmModal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={t("common.confirmTitle")}
        message={confirmAction === "leave" ? t("chat.leaveChat") : confirmAction === "delete" ? t("chat.deleteChat") : ""}
        confirmText={confirmAction === "leave" ? t("chat.leave") : t("common.delete")}
        onConfirm={handleConfirmAction}
        variant="danger"
      />
      {showContactPickerModal && (
        <ModalViewportLayer onBackdropClick={() => setShowContactPickerModal(false)} className="!bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full max-h-[70vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b font-medium text-slate-800">{t("chat.pickContact")}</div>
            <div className="overflow-y-auto p-2">
              {contacts.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">{t("chat.noContacts")}</p>
              ) : (
                contacts.map((c) => (
                  <button key={c.id} type="button" onClick={() => handleShareContact(c)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left transition-colors">
                    {c.contact_user.avatar_url || c.contact_user.avatar ? (
                      <MediaImage source={c.contact_user.avatar_url || c.contact_user.avatar!} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0 flex items-center justify-center text-slate-600 font-medium">
                        {(c.local_name || c.contact_user.display_name || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 truncate">{c.local_name || userDisplayName(c.contact_user)}</p>
                      {(c.contact_user as User).username && (
                        <p className="text-xs text-slate-500 truncate">@{(c.contact_user as User).username}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </ModalViewportLayer>
      )}
      <div
        ref={chatAreaRef}
        className="flex flex-col flex-1 min-w-0 min-h-0 relative overflow-hidden pb-[calc(env(safe-area-inset-bottom)+var(--keyboard-bottom-inset,0px))]"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onTouchStart={(e) => {
          if (e.touches.length !== 1 || (!onBack && !isCommentsView)) return;
          swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          if (e.changedTouches.length !== 1 || (!onBack && !isCommentsView) || !swipeStartRef.current) return;
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          const endX = e.changedTouches[0].clientX;
          const endY = e.changedTouches[0].clientY;
          const dx = endX - start.x;
          const dy = endY - start.y;
          if (dx > SWIPE_THRESHOLD_PX && Math.abs(dy) < 120) handleBackAction();
        }}
        onTouchCancel={() => { swipeStartRef.current = null; }}
      >
        {/* Drag overlay — затемняет всю область включая хедер */}
        {dragOver && (
          <div className="absolute inset-0 z-40 flex flex-col pointer-events-none bg-black/15">
            <div className={`flex-1 flex items-center justify-center border-4 border-dashed rounded-t-xl m-2 mb-1 transition-colors ${
              dropZone === "top" ? "border-blue-500 bg-blue-50/80" : "border-slate-300 bg-slate-50/60"
            }`}>
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={dropZone === "top" ? "#0697d7" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p className={`text-sm font-medium ${dropZone === "top" ? "text-blue-600" : "text-slate-400"}`}>Отправить как файл</p>
                <p className={`text-xs ${dropZone === "top" ? "text-blue-500" : "text-slate-400"}`}>Без предпросмотра</p>
              </div>
            </div>
            <div className={`flex-1 flex items-center justify-center border-4 border-dashed rounded-b-xl m-2 mt-1 transition-colors ${
              dropZone === "bottom" ? "border-green-500 bg-green-50/80" : "border-slate-300 bg-slate-50/60"
            }`}>
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={dropZone === "bottom" ? "#22c55e" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                <p className={`text-sm font-medium ${dropZone === "bottom" ? "text-green-600" : "text-slate-400"}`}>Отправить как фото</p>
                <p className={`text-xs ${dropZone === "bottom" ? "text-green-500" : "text-slate-400"}`}>С предпросмотром изображений</p>
              </div>
            </div>
          </div>
        )}

        {/* Header — sticky on mobile so it stays visible when keyboard opens */}
      <header
        className="chat-topbar-surface sticky z-30 shrink-0 border-b backdrop-blur px-4 h-16 flex items-center gap-3"
        style={{
          top: "calc(env(safe-area-inset-top) + var(--visual-viewport-offset-top, 0px))",
        }}
      >
          {selectionMode ? (
            <>
              {onBack && (
                <button type="button" onClick={handleExitSelectionMode} className="md:hidden shrink-0 p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
              )}
              <button type="button" onClick={handleExitSelectionMode} className="text-blue-600 hover:text-blue-700 font-medium text-sm">
                {t("chat.cancelSelect")}
              </button>
              <span className="text-slate-600 text-sm">{selectedMessageIds.size} {t("chat.selectMode").toLowerCase()}</span>
            </>
          ) : (
            <>
              {(onBack || isCommentsView) && (
                <button
                  type="button"
                  onClick={handleBackAction}
                  className={`shrink-0 p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color] ${!isCommentsView ? "md:hidden" : ""}`}
                  title={isCommentsView ? t("common.back") : t("chat.toChatList")}
                  aria-label={isCommentsView ? t("common.back") : t("chat.toChatList")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
              )}
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              {displayChat?.is_personal && displayChat.other_member ? (
                <Link
                  to={buildUserInfoHref(displayChat.other_member)}
                  className="block rounded-full overflow-hidden hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-2 focus:ring-offset-white/70"
                  title={t("chat.personInfo")}
                >
                  {(displayChat.other_member?.avatar_url ?? displayChat.other_member?.avatar) ? (
                    <MediaImage
                      source={getAvatarUrlBySize(displayChat.other_member!.avatar_url ?? displayChat.other_member!.avatar, displayChat.other_member!.avatar_url_small, displayChat.other_member!.avatar_url_medium, "small")}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                      {getAvatarInitials(userDisplayName(displayChat.other_member))}
                    </div>
                  )}
                  {onlineStatus[displayChat.other_member.id]?.is_online && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full shadow-sm" />
                  )}
                </Link>
              ) : displayChat?.is_favorites ? (
                <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </div>
              ) : displayChat?.avatar_url ? (
                <MediaImage
                  source={getAvatarUrlBySize(displayChat.avatar_url, displayChat.avatar_url_small, displayChat.avatar_url_medium, "small")}
                  alt=""
                  className="w-9 h-9 rounded-full object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                  {getAvatarInitials(displayChat?.title || "Ч")}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { if (isCommentsView) return; setInfoUserId(null); setShowInfo(!showInfo); }}
              className={`flex-1 text-left rounded-xl px-2.5 py-1.5 -mx-2 min-w-0 ${isCommentsView ? "cursor-default" : "hover:bg-slate-50/70 transition-colors"}`}
            >
              <h1 className="font-semibold text-slate-900 flex items-center gap-1.5 tracking-tight">
                {isCommentsView ? (
                  t("channelComments.title")
                ) : (<>
                {displayChat?.is_favorites ? t("chat.favoritesTitle") : displayChat?.is_personal && displayChat.other_member ? userDisplayName(displayChat.other_member) : displayChat?.title ?? "…"}
                </>)}
                {!isCommentsView && displayChat?.title_icon && <span className="shrink-0" aria-hidden>{displayChat.title_icon}</span>}
                {!isCommentsView && displayChat?.is_secret && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600" aria-label={t("chat.e2ee")}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
                {!isCommentsView && isMuted && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-label={t("dashboard.muted")}>
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                  </svg>
                )}
              </h1>
              {(!displayChat?.is_favorites || isCommentsView) && (
                <p className="text-sm text-slate-600">
                  {isCommentsView ? (
                    `${visiblePostComments.length}${displayChat?.title ? ` - ${displayChat.title}` : ""}`
                  ) : (<>
                  {displayChat?.is_personal && displayChat.other_member ? (
                    typing ? (
                      <span className="text-slate-400 italic">{typing} {t("chat.typing")}</span>
                    ) : (
                      <>
                        {displayChat.is_secret && <span>{t("secretChat.title")}</span>}
                        {onlineStatus[displayChat.other_member.id]?.is_online ? (
                          <span className={displayChat.is_secret ? " text-green-500 ml-1" : " text-green-500"}>{displayChat.is_secret ? " · " : ""}{t("chat.online")}</span>
                        ) : onlineStatus[displayChat.other_member.id]?.last_seen_display ? (
                          <span className={displayChat.is_secret ? " ml-1" : ""}>{displayChat.is_secret ? " · " : ""}{formatLastSeen(onlineStatus[displayChat.other_member.id].last_seen_display, lang)}</span>
                        ) : null}
                      </>
                    )
                  ) : (
                    (() => {
                      const onlineCount = members.filter((m) => onlineStatus[m.user.id]?.is_online && m.user.id !== myUserId).length + (onlineStatus[myUserId]?.is_online ? 1 : 0);
                      // Prefer live members list (active only). Fallback to chat.members_count for shell/loading.
                      const totalMembers = activeMembers.length > 0 ? activeMembers.length : (displayChat?.members_count ?? 0);
                      const membersLabel = formatMembersCount(totalMembers, lang);
                      const onlineLabel = onlineCount > 0 ? ` · ${onlineCount} ${t("chat.online")}` : "";
                      return membersLabel + onlineLabel;
                    })()
                  )}
                  </>)}
                </p>
              )}
            </button>
          </div>
          {!isCommentsView && (
            <>
              <button
                type="button"
                onClick={() => { setSearchOpen((v) => { if (v) { setSearchQuery(""); setSearchResults([]); } return !v; }); setTimeout(() => searchInputRef.current?.focus(), 100); }}
                className={`p-2 rounded-xl transition-[background-color,color,transform] active:scale-[0.98] ${searchOpen ? "bg-blue-600 text-white shadow-sm shadow-blue-600/15" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/80"}`}
                title={t("search.placeholder")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </button>
              <button type="button" onClick={() => { setInfoUserId(null); setShowInfo(!showInfo); }} className={`p-2 rounded-xl transition-[background-color,color,transform] active:scale-[0.98] ${showInfo ? "bg-blue-600 text-white shadow-sm shadow-blue-600/15" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/80"}`} title={t("chat.chatInfo")}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              </button>
            </>
          )}
            </>
          )}
      </header>

        {/* ── Search bar ── */}
        {!isCommentsView && searchOpen && (
          <div className="shrink-0 bg-white border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
            <div className="flex-1 relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }
                  if (e.key === "Enter" && searchResults.length > 0) {
                    setSearchIdx((prev) => (prev + 1) % searchResults.length);
                  }
                }}
                placeholder={chat?.is_secret ? t("search.secretLocal") : t("search.placeholder")}
                spellCheck={false}
                className="w-full pl-8 pr-2.5 py-1 ui-text-assist border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-slate-50"
                autoFocus
              />
            </div>
            {searchQuery.trim().length >= 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-slate-500 tabular-nums min-w-[3ch] text-center">
                  {searchLoading ? "…" : searchResults.length > 0 ? `${searchIdx + 1}/${searchTotal}` : "0"}
                </span>
                {!searchLoading && searchResults[searchIdx]?.content && (
                  <span className="hidden max-w-[18rem] truncate text-[0.6875rem] text-slate-400 md:inline">
                    {buildSearchSnippet(searchResults[searchIdx]?.content, searchQuery, 26)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSearchIdx((prev) => (prev - 1 + searchResults.length) % searchResults.length)}
                  disabled={searchResults.length === 0}
                  className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  title="Previous"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setSearchIdx((prev) => (prev + 1) % searchResults.length)}
                  disabled={searchResults.length === 0}
                  className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  title="Next"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }}
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        )}

        {/* ── Unified pinned messages bar (always visible, not scrollable) ── */}
        {!isCommentsView && (() => {
          const allPinned = chat?.pinned_messages ?? (chat?.pinned_message ? [chat.pinned_message] : []);
          const myPinned = chat?.my_pinned_messages ?? [];
          // Deduplicate: personal pins that are also pinned for all → show only once
          const allPinnedIds = new Set(allPinned.map((m) => m.id));
          const uniqueMyPinned = myPinned.filter((m) => !allPinnedIds.has(m.id));

          // Merge into a single ordered list: shared pins first, then personal-only
          const unifiedPins: { message: Message; scope: "all" | "me" }[] = [
            ...allPinned.map((m) => ({ message: m, scope: "all" as const })),
            ...uniqueMyPinned.map((m) => ({ message: m, scope: "me" as const })),
          ];
          if (unifiedPins.length === 0) return null;

          const safeIdx = pinnedIndex % unifiedPins.length;
          const current = unifiedPins[safeIdx];
          const pinSender = userDisplayName((current.message.sender as User) || { display_name: "", phone: "" });
          const mt = current.message.msg_type;
          const pinPreview =
            mt === "gif" ? "GIF" :
            mt === "sticker" ? t("common.stickerMsg") :
            (mt !== "text" && mt !== "emoji") ? t("common.fileMsg") :
            (current.message.content || "").trim().slice(0, 80);

          const pinLabel = unifiedPins.length > 1
            ? `${t("pin.pinned")} #${safeIdx + 1}${current.scope === "me" ? ` · ${t("pin.forYou")}` : ""} · ${pinSender}`
            : current.scope === "me"
              ? `${t("pin.pinnedForYou")} · ${pinSender}`
              : pinSender;

          return (
          <div
            className="chat-topbar-surface shrink-0 border-b backdrop-blur z-20"
          >
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50/70 transition-colors min-h-[42px]"
                onClick={() => {
                  const el = document.querySelector(`[data-message-id="${current.message.id}"]`);
                  el?.previousElementSibling?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                  if (unifiedPins.length > 1) {
                    setPinnedIndex((safeIdx + 1) % unifiedPins.length);
                  }
                }}
              >
                {/* Dot indicator */}
                {unifiedPins.length > 1 ? (
                  <div className="flex flex-col gap-[2px] shrink-0" style={{ height: 24 }}>
                    {unifiedPins.map((p, i) => (
                      <div
                        key={i}
                        className={`w-[3px] rounded-full transition-colors ${
                          i === safeIdx
                            ? (p.scope === "me" ? "bg-sky-400" : "bg-blue-500")
                            : (p.scope === "me" ? "bg-sky-200" : "bg-slate-300")
                        }`}
                        style={{ height: `${Math.max(3, 24 / unifiedPins.length - 2)}px` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={`w-[3px] h-[24px] rounded-full shrink-0 ${current.scope === "me" ? "bg-sky-400" : "bg-blue-500"}`} />
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-medium text-blue-600 truncate">
                    {pinLabel}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{pinPreview}</div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V17"/><path d="M12 2v5"/></svg>
              </button>
            </div>
          );
        })()}

        {/* Messages — background: vector default (instant) or custom image */}
        <div className="relative flex-1 min-h-0 flex flex-col min-w-0">
          <div
            className="absolute inset-0 pointer-events-none z-0"
            aria-hidden
            style={
              displayChatBackgroundUrl
                ? {
                    backgroundImage: `url(${toSameOriginMediaUrl(displayChatBackgroundUrl)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    opacity: "var(--chat-bg-image-opacity)",
                    filter: "var(--chat-bg-filter)",
                  }
                : {
                    background: "var(--chat-bg-vector-default)",
                    opacity: 1,
                  }
            }
          />
          <div className="absolute inset-0 pointer-events-none z-0" aria-hidden style={{ background: "var(--chat-bg-overlay)" }} />
          <div className="absolute inset-0 pointer-events-none z-0" aria-hidden style={{ backgroundImage: "var(--chat-bg-vignette)" }} />
          <div
            ref={setMessagesScrollRef}
            className="chat-thread-canvas chat-messages-scroll flex-1 min-h-0 p-2.5 pb-3 sm:pt-3 sm:px-3.5 scrollbar-hide relative z-10"
            onContextMenu={(e) => e.preventDefault()}
            onScroll={handleMessagesScroll}
          >
          {!chat && !channelRaw && !loading ? (
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
              <p className="text-slate-500">{t("chat.loadError")}</p>
            </div>
          ) : isCommentsView ? (
          <div className="min-h-full flex flex-col">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
              <div className="shrink-0 py-2">
                {openCommentsPost && channelId && channelRaw && (
                  <div className="rounded-[28px] border border-white/70 bg-white/80 p-1 shadow-sm backdrop-blur">
                    <MessageBubble
                      message={openCommentsPost}
                      isMine={false}
                      chatId={conversationId}
                      channelId={channelId}
                      showAvatar
                      onMessageUpdated={handleCommentsPostUpdated}
                      onReactionUpdated={handleChannelPostReactionUpdated}
                      onSetReaction={(messageId, emoji) =>
                        channelPostsApi.setReaction(channelId, messageId, emoji).then((res) =>
                          channelPostToMessage(res.data, channelId, channelRaw)
                        )}
                      onAvatarClick={handleAvatarClick}
                    />
                  </div>
                )}
              </div>
              {commentsLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-500">{t("channelComments.loading")}</div>
              ) : visiblePostComments.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-500">{t("channelComments.empty")}</div>
              ) : (
                <div className="flex flex-col pb-2">
                  {postComments.map((msg, index) => {
                    const layout = getChatMessageLayoutMeta(postComments, index);
                    const isMine = (msg as Message & { authorId?: string }).authorId === myUserId;
                    return (
                      <div key={msg.id} className="bubbles-group transition-all duration-300" style={{ marginTop: `${layout.rowGapPx}px` }}>
                        {layout.showDateDivider && <DateDivider date={msg.created_at} lang={language} />}
                        <MessageBubble
                          message={msg}
                          isMine={isMine}
                          chatId={conversationId}
                          showAvatar={layout.showAvatar}
                          isLastInGroup={layout.isLastInGroup}
                          showSenderName={layout.isFirstInGroup}
                          onMessageUpdated={handleCommentUpdated}
                          onMessageDeleted={handleCommentDeleted}
                          onUpdateMessageContent={handleUpdateCommentContent}
                          onDeleteMessage={handleDeleteComment}
                          onDeleteError={handleDeleteError}
                          onReply={setReplyToComment}
                          onAvatarClick={handleAvatarClick}
                        />
                      </div>
                    );
                  })}
                  <div ref={commentsEndRef} />
                </div>
              )}
            </div>
          </div>
          ) : (
          <div className="min-h-full flex flex-col">
          {/* Floating date on scroll (sticky date header) — first visible message by scroll position (works with and without virtualization) */}
          {messages.length > 0 && (() => {
            const showSticky = messagesScrollTop > 56;
            const firstVisibleIndex = Math.max(0, Math.min(messages.length - 1, lowerBound(virtualState.offsets, messagesScrollTop) - 1));
            const firstVisible = messages[firstVisibleIndex];
            const stickyLabel = showSticky && firstVisible ? formatDateLabel(firstVisible.created_at, language) : null;
            return stickyLabel ? (
              <div className="sticky top-0 z-20 flex justify-center pt-2 pb-1 -mt-2 pointer-events-none shrink-0" aria-hidden>
                <span className="px-3 py-1.5 rounded-full bg-slate-700/95 text-white text-xs font-medium shadow-lg backdrop-blur">
                  {stickyLabel}
                </span>
              </div>
            ) : null;
          })()}
          <div
            ref={messagesWrapperRef}
            className={`flex flex-col space-y-0 min-h-full ${useBottomAnchor ? "justify-end" : ""}`}
          >
          {/* E2EE banner for secret chat */}
          {chat?.is_secret && (
            <div className="shrink-0 flex justify-center py-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>{t("chat.e2ee")}</span>
              </div>
            </div>
          )}
          {/* Join requests — displayed as a regular message in the feed; can be hidden (approve only in info panel) */}
          {!chat?.is_personal && pendingMembers.length > 0 && chat?.owner?.id === myUserId && !joinRequestsPanelHidden && (
            <div className="shrink-0 flex justify-center my-3">
              <div className="inline-block max-w-[85%] rounded-2xl bg-slate-100/90 border border-slate-200 px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-xs font-medium text-slate-500">{t("chat.pendingRequests")} ({pendingMembers.length})</p>
                  <button
                    type="button"
                    onClick={handleHideJoinRequestsPanel}
                    className="text-xs text-slate-400 hover:text-slate-600 shrink-0"
                    title={t("chat.hideJoinRequests")}
                  >
                    {t("chat.hide")}
                  </button>
                </div>
                <ul className="space-y-3">
                  {pendingMembers.map((m) => (
                    <li key={m.id} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600 shrink-0">
                        {getAvatarInitials(userDisplayName(m.user))}
                      </div>
                      <span className="text-sm text-slate-800 truncate flex-1 min-w-0">{userDisplayName(m.user)}</span>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={approveRejectLoading !== null}
                          onClick={() => handleApproveMember(m.id)}
                          className="text-sm px-4 py-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50 font-medium transition-colors"
                        >
                          {approveRejectLoading === m.id ? "…" : t("chat.add")}
                        </button>
                        <button
                          type="button"
                          disabled={approveRejectLoading !== null}
                          onClick={() => handleRejectMember(m.id)}
                          className="text-sm px-4 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 font-medium transition-colors"
                        >
                          Отклонить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {messages.length > 0 ? (
            (() => {
              const showUnreadLine = !unreadLineDismissed && initialUnreadIds.length > 0;
              const firstUnreadIndex = showUnreadLine
                ? messages.findIndex((m) => initialUnreadIds.includes(m.id))
                : -1;
              const start = virtualState.enabled ? virtualState.start : 0;
              const end = virtualState.enabled ? virtualState.end : messages.length;
              const visibleMessages = messages.slice(start, end);
              return (
                <Fragment>
                  {/* Sentinel for loading older messages on scroll up — min-height so IntersectionObserver can fire when scrolled to top */}
                  <div
                    ref={loadMoreSentinelRef}
                    className="shrink-0"
                    style={hasOlderMessages && !loadingOlder ? { minHeight: 1 } : undefined}
                    aria-hidden
                  >
                    {loadingOlder && (
                      <div className="flex justify-center items-center gap-2 py-2">
                        <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin shrink-0" />
                        <span className="text-xs text-slate-500">{t("common.loading")}</span>
                      </div>
                    )}
                    {!hasOlderMessages && messages.length > 0 && (
                      <div className="flex justify-center py-3">
                        <span className="text-xs text-slate-400">{t("chat.conversationStart")}</span>
                      </div>
                    )}
                  </div>
                  {virtualState.enabled && <div style={{ height: virtualState.topPadding }} aria-hidden />}
                  {visibleMessages.map((msg, offset) => {
                    const i = start + offset;
                    const isMine = channelId
                      ? ((msg as Message & { authorId?: string }).authorId === myUserId)
                      : (msg.id?.startsWith("upload-") || ((msg as Message & { sender_display_name?: string }).sender_display_name ? false : getSenderId(msg) === myUserId));
                    const layout = getChatMessageLayoutMeta(messages, i);
                    const msgTime = msg.created_at ? new Date(msg.created_at).getTime() : 0;
                    const isNewMessage = msgTime > 0 && Date.now() - msgTime < 2800;
                    const commentsCount = msg.comments_count ?? 0;
                    const canOpenComments = !!channelId && !!channelRaw && (channelRaw.comments_enabled || commentsCount > 0);
                    return (
                      <div
                        key={msg.id}
                        data-msg-wrapper={msg.id}
                        ref={(el) => {
                          if (!el) return;
                          const nextHeight = el.offsetHeight;
                          const prevHeight = rowHeightsRef.current.get(msg.id);
                          if (prevHeight == null || Math.abs(prevHeight - nextHeight) > 2) {
                            const scrollRoot = messagesScrollRef.current;
                            if (scrollRoot) {
                              const threshold = 140;
                              const distToBottom = scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight;
                              if (distToBottom < threshold) pinToBottomAfterMeasureRef.current = true;
                            }
                            rowHeightsRef.current.set(msg.id, nextHeight);
                            setVirtualMeasureTick((v) => v + 1);
                          }
                        }}
                        className={`bubbles-group transition-all duration-300${isNewMessage ? " message-enter" : ""}`}
                        style={{ marginTop: `${layout.rowGapPx}px` }}
                      >
                        {layout.showDateDivider && <DateDivider date={msg.created_at} lang={language} />}
                        {showUnreadLine && i === firstUnreadIndex && (
                          <div data-unread-line className="flex items-center gap-3 py-1.5">
                            <span className="flex-1 h-px bg-slate-300" aria-hidden />
                            <span className="text-xs font-medium text-slate-500 shrink-0">{t("chat.newMessagesLine")}</span>
                            <span className="flex-1 h-px bg-slate-300" aria-hidden />
                          </div>
                        )}
                        <MessageBubble
                          message={msg}
                          isMine={isMine}
                          uploadProgress={(() => { const u = activeUploads.find((x) => x.tempId === msg.id); return u ? { loaded: u.loaded, total: u.total } : undefined; })()}
                          onCancelUpload={msg.id?.startsWith("upload-") ? cancelUpload : undefined}
                          downloadProgress={downloadProgressByMessageId[msg.id]}
                          onDownloadWithProgress={channelId ? undefined : (messageId, url, filename) => {
                            const fullUrl = toSameOriginMediaUrl(url);
                            const token = useAuthStore.getState().accessToken;
                            const xhr = new XMLHttpRequest();
                            xhr.open("GET", fullUrl);
                            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
                            xhr.responseType = "blob";
                            setDownloadProgressByMessageId((prev) => ({ ...prev, [messageId]: { loaded: 0, total: 0 } }));
                            xhr.onprogress = (e) => {
                              if (e.lengthComputable) setDownloadProgressByMessageId((prev) => ({ ...prev, [messageId]: { loaded: e.loaded, total: e.total } }));
                            };
                            xhr.onload = () => {
                              setDownloadProgressByMessageId((prev) => { const n = { ...prev }; delete n[messageId]; return n; });
                              if (xhr.status !== 200) return;
                              const blob = xhr.response as Blob;
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = filename.replace(/[\\/:*?"<>|]+/g, "_");
                              a.click();
                              URL.revokeObjectURL(a.href);
                            };
                            xhr.onerror = () => setDownloadProgressByMessageId((prev) => { const n = { ...prev }; delete n[messageId]; return n; });
                            xhr.send();
                          }}
                          showAvatar={layout.showAvatar}
                          isLastInGroup={layout.isLastInGroup}
                          showSenderName={layout.isFirstInGroup && shouldShowSenderNames}
                          chatId={conversationId!}
                          channelId={channelId ?? undefined}
                          onMessageUpdated={handleMessageUpdated}
                          onMessageDeleted={handleMessageDeleted}
                          onUpdateMessageContent={handleUpdateMessageContent}
                          onDeleteMessage={handleDeleteMessage}
                          onDeleteError={handleDeleteError}
                          onStartEditInInput={handleStartEditInInput}
                          canPinForAll={canPinForAll}
                          pinnedForAllIds={pinnedForAllIds}
                          maxPins={maxPins}
                          myPinnedIds={myPinnedIds}
                          onPinChange={refreshChat}
                          onReply={channelId ? undefined : handleReply}
                          onForward={handleForward}
                          onAvatarClick={handleAvatarClick}
                          selectionMode={selectionMode}
                          isSelected={selectedMessageIds.has(msg.id)}
                          onToggleSelect={handleToggleSelect}
                          onEnterSelectionMode={handleEnterSelectionMode}
                          onSetReaction={channelId && channelRaw ? (messageId, emoji) =>
                            channelPostsApi.setReaction(channelId, messageId, emoji).then((res) =>
                              channelPostToMessage(res.data, channelId, channelRaw)
                            ) : undefined}
                          commentsCount={canOpenComments ? commentsCount : undefined}
                          onOpenComments={canOpenComments ? () => openPostComments(msg) : undefined}
                          onReactionUpdated={handleReactionUpdated}
                          reactionPickerOpen={openReactionPickerMessageId === msg.id}
                          onOpenReactionPicker={() => setOpenReactionPickerMessageId(msg.id)}
                          onCloseReactionPicker={() => setOpenReactionPickerMessageId(null)}
                        />
                        <div
                          ref={(el) => {
                            if (el) sentinelRefs.current.set(msg.id, el);
                            else sentinelRefs.current.delete(msg.id);
                          }}
                          data-message-id={msg.id}
                          className="w-full shrink-0"
                          style={{ height: layout.sentinelHeight }}
                          aria-hidden
                        />
                      </div>
                    );
                  })}
                  {virtualState.enabled && <div style={{ height: virtualState.bottomPadding }} aria-hidden />}
                </Fragment>
              );
            })()
          ) : loadingMessages ? (
            <MessageListSkeleton />
          ) : (
            <div className="flex-1 flex items-center justify-center min-h-[96px] px-3">
              <div className="max-w-[320px] rounded-2xl border border-slate-200/70 bg-white/82 px-4 py-3.5 text-center shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur">
                {chat?.is_favorites ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-lg">⭐</span>
                      <span className="text-sm font-semibold text-slate-700">{t("chat.favoritesTitle")}</span>
                    </div>
                    <p className="text-xs leading-5 text-slate-500 max-w-[260px]">{t("chat.favoritesHint")}</p>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">{t("chat.emptyChat")}</p>
                    <p className="mx-auto max-w-[250px] text-xs leading-5 text-slate-500">{t("chat.emptyChatHint")}</p>
                  </>
                )}
              </div>
            </div>
          )}
        <div ref={bottomRef} />
          </div>
          </div>
          )}
        </div>
      {!isCommentsView && showScrollToBottom && (
        <button
          type="button"
          onClick={() => { scrollToBottom(); setShowScrollToBottom(false); }}
          className="absolute bottom-20 sm:bottom-4 right-4 z-10 w-10 h-10 rounded-full bg-slate-700 text-white shadow-lg hover:bg-slate-600 flex items-center justify-center transition-colors"
          title={t("chat.scrollDown")}
          aria-label={t("chat.scrollDown")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
        </button>
      )}
        </div>

        {/* Upload error */}
        {(uploadError || messageDeleteError) && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-600 text-sm">
            {uploadError || messageDeleteError}
          </div>
        )}

        {/* Scheduled list */}
        {scheduledList.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2">
            <p className="text-xs text-slate-500 font-medium mb-1">Отложенные ({scheduledList.length})</p>
            <ul className="space-y-1 max-h-24 overflow-y-auto">
              {scheduledList.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm bg-white rounded px-2 py-1 border border-slate-200">
                  <span className="truncate flex-1 text-slate-700">{s.content}</span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(s.scheduled_at).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {s.recurrence !== "none" && ` · ${s.recurrence === "daily" ? t("chat.daily") : t("chat.weekly")}`}
                  </span>
                  <button type="button" onClick={() => { if (chatId) scheduledApi.delete(chatId, s.id).then(() => refreshScheduled()); }} className="text-xs text-red-600 hover:text-red-800 shrink-0">Отменить</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Video recording overlay */}
        {videoRecording && (
          <div className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center">
            <div className="bg-slate-900 rounded-2xl p-4 flex flex-col items-center gap-4 max-w-md w-full mx-4">
              {/* Camera preview */}
              <div className="bg-black overflow-hidden w-56 h-56 rounded-full">
                <video
                  ref={videoPreviewRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover rounded-full"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
              {/* Timer */}
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-white font-medium text-lg">
                  Кружочек — {fmtTime(videoRecordingTime)}
                </span>
                <span className="text-slate-400 text-sm">/ {fmtTime(MAX_VIDEO_DURATION)}</span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-slate-700 rounded-full h-1">
                <div
                  className="bg-red-500 h-1 rounded-full transition-all duration-1000"
                  style={{ width: `${(videoRecordingTime / MAX_VIDEO_DURATION) * 100}%` }}
                />
              </div>
              {/* Controls */}
              <div className="flex gap-4">
                <button type="button" onClick={cancelVideoRecording} className="bg-slate-700 text-white px-5 py-2.5 rounded-lg hover:bg-slate-600 text-sm font-medium transition-colors flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  Отменить
                </button>
                <button type="button" onClick={stopVideoRecording} className="bg-sky-400 text-white px-5 py-2.5 rounded-xl hover:bg-sky-500 text-sm font-medium transition-colors flex items-center gap-2">
                  <SendIcon size={18} />
                  {t("common.send")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Selection action bar */}
        {!isCommentsView && selectionMode && selectedMessageIds.size > 0 && (
          <div className="chat-topbar-surface border-t px-4 py-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleBulkDelete}
              className="px-4 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium text-sm transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              {t("chat.deleteSelected")} ({selectedMessageIds.size})
            </button>
            <button
              type="button"
              onClick={handleBulkForward}
              className="px-4 py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium text-sm transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              {t("chat.forwardSelected")} ({selectedMessageIds.size})
            </button>
          </div>
        )}

        {/* Input bar — visible as soon as we're on a chat (conversationId) so layout doesn't jerk when chat loads */}
        {conversationId && (isCommentsView ? (
          <div
            className="chat-composer-surface shrink-0 relative z-20 border-t backdrop-blur"
          >
            {commentsError && <div className="px-4 pt-3 text-sm text-red-600">{commentsError}</div>}
            {replyToComment && (
              <div className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-blue-700">{t("channelComments.replyTo")}</div>
                  <div className="truncate text-xs text-slate-600">
                    {userDisplayName(replyToComment.sender as User)}: {(replyToComment.content || "").trim() || t("common.fileMsg")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyToComment(null)}
                  className="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-800"
                >
                  {t("channelComments.cancelReply")}
                </button>
              </div>
            )}
            {channelRaw?.comments_enabled ? (
              canCommentInChannel ? (
              <div className="p-2 sm:p-2.5 flex gap-2 items-end">
                <textarea
                  value={commentInput}
                  onChange={(event) => setCommentInput(event.target.value.slice(0, MESSAGE_MAX_LENGTH))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendComment();
                    }
                  }}
                  rows={1}
                  placeholder={t("channelComments.placeholder")}
                  className="min-h-[46px] max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 px-3 py-3 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  type="button"
                  onClick={() => void handleSendComment()}
                  disabled={commentSubmitting || !commentInput.trim()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("common.send")}
                >
                  <SendIcon size={18} />
                </button>
              </div>
              ) : (
                <div className="px-4 py-3 text-center text-sm text-slate-500">
                  <p>{t("channelComments.noAccess")}</p>
                </div>
              )
            ) : (
              <div className="px-4 py-3 text-center text-sm text-slate-500">{t("channelComments.disabled")}</div>
            )}
          </div>
        ) : recording ? (
          <div className="shrink-0 border-t bg-white p-2 flex gap-2 items-center">
            <button type="button" onClick={cancelRecording} className="text-red-500 hover:text-red-700 px-3 py-2 rounded-lg hover:bg-red-50 shrink-0" title={t("chat.cancelRecording")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse shrink-0" />
                <span className="text-slate-700 font-medium text-sm">Запись… {fmtTime(recordingTime)}</span>
                <div className="flex items-center gap-1.5 ml-auto shrink-0" aria-hidden>
                  <div className="w-1.5 h-8 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="w-full bg-red-500 rounded-full transition-all duration-100"
                      style={{ height: `${Math.min(100, (voiceLevel / 255) * 100)}%`, minHeight: voiceLevel > 0 ? "4px" : "0" }}
                    />
                  </div>
                  <span className="text-[0.625rem] text-slate-500 tabular-nums">{Math.round((voiceLevel / 255) * 100)}%</span>
                </div>
              </div>
              <div className="flex items-end gap-0.5 h-6" aria-hidden>
                {liveWaveform.length > 0 ? liveWaveform.map((h, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full min-h-[4px] transition-all duration-75"
                    style={{
                      height: `${Math.max(4, (h / 255) * 24)}px`,
                      backgroundColor: h > 128 ? "#ef4444" : h > 32 ? "#f87171" : "#fca5a5",
                    }}
                  />
                )) : null}
              </div>
            </div>
            <button type="button" onClick={stopRecording} className="bg-sky-400 text-white px-4 py-2 rounded-xl hover:bg-sky-500 flex items-center gap-2 shrink-0">
              <SendIcon size={18} />
              {t("common.send")}
            </button>
          </div>
        ) : (
          <div
            className="chat-composer-surface shrink-0 relative z-20 border-t backdrop-blur"
          >
            {channelId && !hasChannelAuthorRole ? (
              <div className="px-4 py-3 text-center text-slate-500 text-sm">{t("channelPage.onlyAuthorCanPost")}</div>
            ) : (
            <>
            {editingMessageId && (
              <div className="px-4 py-2 border-b border-slate-200/70 flex items-center justify-between bg-amber-50/70">
                <span className="text-xs font-medium text-amber-800">Редактирование сообщения</span>
                <button type="button" onClick={cancelEditMessage} className="text-xs text-amber-700 hover:text-amber-900 font-medium">Отмена</button>
              </div>
            )}
            {aiListening && (
              <div className="px-4 py-2 border-b border-slate-200/70 flex items-center justify-between bg-blue-50/70">
                <span className="text-xs font-medium text-blue-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  AI-голосовой ввод — речь переводится в текст в поле ниже
                </span>
                <button type="button" onClick={stopAiListening} className="text-xs text-blue-700 hover:text-blue-900 font-medium">Остановить</button>
              </div>
            )}
            {emojiPicker.open && emojiFiltered.length > 0 && (
              <div className="absolute bottom-full left-2 right-2 sm:right-auto sm:left-2 z-50 mb-1 py-1 bg-white rounded-xl border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
                <p className="px-3 py-1 text-xs text-slate-500 border-b border-slate-100">{t("chat.emoji")}</p>
                {emojiFiltered.map((item, i) => {
                  const selected = i === Math.min(emojiPicker.selectedIndex, emojiFiltered.length - 1);
                  return (
                    <button
                      key={item.shortcode}
                      type="button"
                      onClick={() => insertEmoji(item.emoji)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition-colors ${selected ? "bg-blue-50" : ""}`}
                    >
                      <span className="text-lg">{item.emoji}</span>
                      <span className="text-sm text-slate-600">:{item.shortcode}:</span>
                    </button>
                  );
                })}
              </div>
            )}
            {mentionPicker.open && mentionFiltered.length > 0 && (
              <div className="absolute bottom-full left-2 right-2 sm:right-auto sm:left-2 z-50 mb-1 py-1 bg-white rounded-xl border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
                <p className="px-3 py-1 text-xs text-slate-500 border-b border-slate-100">Упомянуть</p>
                {mentionFiltered.map((m, i) => {
                  const u = m.user as User;
                  const mentionText = u.username || u.display_name || u.phone || u.id;
                  const displayLabel = u.username ? `@${u.username}` : (u.display_name || u.phone || u.id);
                  const selected = i === Math.min(mentionPicker.selectedIndex, mentionFiltered.length - 1);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => insertMention(mentionText)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition-colors ${selected ? "bg-blue-50" : ""}`}
                    >
                      <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-sm font-medium shrink-0">
                        {getAvatarInitials(u.display_name || u.username || u.phone || "?")}
                      </span>
                      <span className="truncate text-sm text-slate-800">{displayLabel}</span>
                      {u.username && u.display_name && u.display_name !== u.username && (
                        <span className="text-xs text-slate-500 truncate hidden sm:inline">{u.display_name}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Reply bar above input */}
            {replyToMessage && (
              <div
                className="mx-3 mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-xl backdrop-blur border shadow-sm"
                style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {userDisplayName((replyToMessage.sender as User) ?? { display_name: "", phone: "" })}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {replyToMessage.msg_type !== "text" && replyToMessage.msg_type !== "emoji"
                      ? "(файл)"
                      : (replyToMessage.content || "").trim().slice(0, 80)}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700 p-2 -m-2 rounded-xl hover:bg-slate-100/70 transition-colors"
                  onClick={() => setReplyToMessage(null)}
                  title={t("chat.cancelReply")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}
            <div className="flex flex-col w-full">
            {input.length > MESSAGE_MAX_LENGTH && (
              <div className="px-2 pb-1 flex flex-col gap-0.5 text-xs">
                <span className="text-red-600 font-medium">{t("chat.charCountLimit").replace("%s", String(input.length))}</span>
                <span className="text-red-600">{t("chat.messageTooLong")}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="p-2 sm:p-2.5 flex gap-1.5 sm:gap-2 items-end">
              <div className="relative" ref={attachMenuRef}>
                <button type="button" onClick={() => setShowAttachMenu((p) => !p)} className={`text-slate-500 hover:text-slate-800 p-2 rounded-xl hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color] ${showAttachMenu ? "bg-slate-100/80" : ""}`} title={t("chat.attach")}>
                  {hasActiveUploads ? (
                    <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  )}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} multiple />
                {showAttachMenu && (
                  <div className="ui-popover-surface absolute bottom-full left-0 z-[100] mb-2 min-w-[11rem] overflow-hidden rounded-2xl py-1">
                    <button type="button" onClick={() => openFileInput(true)} className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      {t("chat.attachFile")}
                    </button>
                    <button type="button" onClick={() => openFileInput(false)} className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                      {t("chat.attachImage")}
                    </button>
                    <button type="button" onClick={handleAttachLocation} className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                      {t("chat.attachLocation")}
                    </button>
                    <button type="button" onClick={() => { setShowContactPickerModal(true); setShowAttachMenu(false); }} className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      {t("chat.attachContact")}
                    </button>
                    {!chat?.is_personal && !chat?.is_favorites && (
                      <button type="button" onClick={() => { setShowCreatePollModal(true); setShowAttachMenu(false); }} className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        {t("chat.poll")}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setShowStickerGifPanel((p) => !p)} className={`text-slate-500 hover:text-slate-800 p-2 rounded-xl hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color] ${showStickerGifPanel ? "bg-slate-100/80" : ""}`} title={t("chat.stickersAndGif")}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              {showStickerGifPanel && (
                <div ref={stickerGifPickerRef} className="absolute bottom-full left-0 right-auto z-[100] mb-1">
                  <StickerGifPanel
                    onSelectEmoji={handleEmojiSelect}
                    onSelectGif={handleSelectGif}
                    onSelectSticker={handleSelectSticker}
                    onManageStickers={() => { setShowStickerGifPanel(false); setShowStickerPackManagerModal(true); }}
                    refreshToken={stickerRefreshToken}
                  />
                </div>
              )}
              <div
                ref={inputEditableRef}
                contentEditable
                suppressContentEditableWarning
                inputMode="text"
                enterKeyHint="send"
                role="textbox"
                aria-multiline
                aria-label={t("chat.messagePlaceholder")}
                lang={lang === "ru" ? "ru" : "en"}
                data-placeholder={t("chat.messagePlaceholder")}
                onInput={(e) => {
                  const el = e.currentTarget;
                  const html = el.innerHTML;
                  const md = htmlToMarkdown(html);
                  setInput(md);
                  if (conversationId) scheduleDraftSave(conversationId, md);
                  const plain = el.innerText || "";
                  const cursor = getEditableCursorOffset(el);
                  setEditablePlainCursor({ plain, cursor });
                  const stack = undoStackRef.current.slice(0, undoIndexRef.current + 1);
                  stack.push(md);
                  if (stack.length > 50) {
                    undoStackRef.current = stack.slice(-50);
                    undoIndexRef.current = 49;
                  } else {
                    undoStackRef.current = stack;
                    undoIndexRef.current = stack.length - 1;
                  }
                  sendTyping();
                  const textBeforeCursor = plain.slice(0, cursor);
                  const lastAt = textBeforeCursor.lastIndexOf("@");
                  if (lastAt !== -1) {
                    const between = textBeforeCursor.slice(lastAt + 1);
                    if (!between.includes(" ") && !between.includes("\n")) {
                      setMentionPicker({ open: true, start: lastAt, selectedIndex: 0 });
                      setEmojiPicker((p) => (p.open ? { ...p, open: false } : p));
                      return;
                    }
                  }
                  setMentionPicker((p) => (p.open ? { ...p, open: false } : p));
                  const lastColon = textBeforeCursor.lastIndexOf(":");
                  if (lastColon !== -1) {
                    const beforeColon = lastColon > 0 ? textBeforeCursor[lastColon - 1] : " ";
                    const isWordChar = /[a-zA-Z0-9]/.test(beforeColon);
                    if (!isWordChar) {
                      const between = textBeforeCursor.slice(lastColon + 1);
                      if (!between.includes(" ") && !between.includes("\n")) {
                        setEmojiPicker({ open: true, start: lastColon, selectedIndex: 0 });
                        return;
                      }
                    }
                  }
                  setEmojiPicker((p) => (p.open ? { ...p, open: false } : p));
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setMentionPicker((p) => (p.open ? { ...p, open: false } : p));
                    setEmojiPicker((p) => (p.open ? { ...p, open: false } : p));
                  }, 150);
                }}
                onKeyDown={handleInputKeyDown}
                onPaste={handlePaste}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const sel = window.getSelection();
                  savedFormatRangeRef.current = (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null) ?? null;
                  setScheduleMenuPos(null);
                  setFormatMenuPos({ x: e.clientX, y: e.clientY, start: 0, end: 0 });
                }}
                {...lpInputHandlers}
                className="flex-1 min-h-[2.25rem] max-h-[11rem] overflow-y-auto resize-none border backdrop-blur rounded-xl px-3 py-2 ui-text-assist focus:outline-none focus:ring-2 focus:ring-blue-400/40 scrollbar-hide empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 shadow-sm"
                style={{
                  height: "38px",
                  background: "var(--surface-2)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-0)",
                }}
              />
            {/* Video circle button */}
            <button type="button" onClick={() => startVideoRecording("video_circle")} className="text-slate-500 hover:text-purple-600 p-2 rounded-xl hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color]" title={t("chat.videoCircle")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
            </button>
            {/* Voice: только запись аудио. Переключение на AI-ввод (речь → текст) временно отключено. */}
            <button
              type="button"
              onClick={() => { if (!lpVoiceFiredRef.current) toggleVoiceInput(); }}
              // onContextMenu={(e) => {
              //   e.preventDefault();
              //   e.stopPropagation();
              //   toggleVoiceMode();
              // }}
              {...lpVoiceHandlers}
              className={`p-2 rounded-xl transition-[background-color,color,transform] active:scale-[0.98] ${voiceInputMode === "ai" ? "text-blue-700 hover:text-blue-800 hover:bg-blue-50/80" : "text-slate-500 hover:text-red-600 hover:bg-slate-100/80"} ${aiListening ? "bg-blue-600 text-white shadow-sm shadow-blue-600/15" : ""}`}
              title={voiceInputMode === "ai" ? (aiListening ? t("chat.stopDictation") : t("chat.aiVoiceInput")) : t("chat.voiceMsg")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </button>
            {input.trim() && (
              <button
                type="submit"
                disabled={input.length > MESSAGE_MAX_LENGTH}
                className="p-2 rounded-2xl flex items-center justify-center transition-[background-color,transform,box-shadow] bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-600/15"
                title={input.length > MESSAGE_MAX_LENGTH ? t("chat.messageTooLong") : t("chat.enterToSend")}
                onMouseDown={(e) => {
                  // Keep focus on the message input on mobile web (avoid closing keyboard when tapping send).
                  e.preventDefault();
                  inputEditableRef.current?.focus();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  inputEditableRef.current?.focus();
                  lpSendHandlers.onTouchStart(e);
                }}
                onTouchMove={lpSendHandlers.onTouchMove}
                onTouchEnd={lpSendHandlers.onTouchEnd}
                onTouchCancel={lpSendHandlers.onTouchCancel}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setScheduleMenuPos({ x: rect.left, y: rect.top });
                }}
                onClick={(e) => { if (lpSendFiredRef.current) { e.preventDefault(); e.stopPropagation(); } }}
              >
                <SendIcon size={20} />
              </button>
            )}
            </form>
            </div>
            </>
            )}
          </div>
        ))}

        {/* Context menu: schedule message (via portal to avoid overflow clipping) */}
        {scheduleMenuPos && createPortal(
          <div
            className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[210px]"
            style={{ left: Math.min(scheduleMenuPos.x, window.innerWidth - 220), top: scheduleMenuPos.y - 44 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              onClick={() => { setShowScheduleModal(true); setScheduleMenuPos(null); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {t("chat.schedule")}
            </button>
            <button
              type="button"
              className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${sendWithoutSoundMode ? "bg-amber-50 text-amber-700" : "text-slate-700 hover:bg-slate-100"}`}
              onClick={() => { setSendWithoutSoundMode((v) => !v); setScheduleMenuPos(null); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              {t("chat.sendWithoutSound")}
              {sendWithoutSoundMode && (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
              )}
            </button>
          </div>,
          document.body,
        )}

        {/* Context menu: Markdown formatting (right-click on input field) — stays within chat bounds */}
        {formatMenuPos && (() => {
          const MENU_W = 260;
          const MENU_H = 340;
          let left = formatMenuPos.x;
          let top = formatMenuPos.y;
          if (chatAreaRef.current) {
            const r = chatAreaRef.current.getBoundingClientRect();
            left = Math.max(r.left, Math.min(left, r.right - MENU_W));
            top = Math.max(r.top, Math.min(top, r.bottom - MENU_H));
          }
          return (
          <>
            <div className="fixed inset-0 z-40" aria-hidden onClick={() => setFormatMenuPos(null)} />
            <div
              className="ui-popover-surface fixed z-50 min-w-[220px] overflow-hidden rounded-2xl py-1"
              style={{ left, top }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-100 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400">Форматирование</div>
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleFormatBold(); }}>
                <strong>Ж</strong> Жирный
              </button>
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleFormatItalic(); }}>
                <em>К</em> Курсив
              </button>
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleFormatStrike(); }}>
                <s>З</s> Зачёркнутый
              </button>
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleFormatLink(); }}>
                <span className="underline">Ссылка</span>
              </button>
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleFormatCopyable(); }}>
                Копируемый при клике
              </button>
              <div className="border-t border-slate-100 my-1" />
              <button type="button" className="ui-list-row flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700" onClick={() => { handleSwitchLayout(); setFormatMenuPos(null); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 6-6 6 6"/><path d="M11 2v10"/><path d="m19 16-6 6-6-6"/><path d="M13 12v10"/></svg>
                Переключить раскладку
                <span className="ml-auto text-xs text-slate-400">Ctrl+T</span>
              </button>
            </div>
          </>
          );
        })()}

        {/* Modal: sticker pack manager */}
        {showStickerPackManagerModal && (
          <StickerPackManagerModal
            isOpen={showStickerPackManagerModal}
            onClose={() => setShowStickerPackManagerModal(false)}
            onPacksUpdated={() => setStickerRefreshToken((t) => t + 1)}
          />
        )}
        {/* Modal: new scheduled message */}
        {showScheduleModal && chatId && (
          <ScheduleMessageModal
            chatId={chatId}
            initialContent={input}
            onClose={() => setShowScheduleModal(false)}
            onSaved={() => { refreshScheduled(); setShowScheduleModal(false); }}
          />
        )}

        {/* Modal: secret chat warning */}
        {showSecretChatWarning && chat?.is_personal && chat.other_member && (
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50"
            onClick={() => { if (!secretChatCreating) setShowSecretChatWarning(false); }}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-md w-full animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
                  </svg>
                </span>
                <h2 className="text-lg font-semibold text-slate-800">{t("secretChat.warningTitle")}</h2>
              </div>
              <div className="px-6 pb-5">
                <ul className="space-y-2.5 text-sm text-slate-700">
                  <li className="flex gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0 mt-0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span>{t("secretChat.warning1")}</span>
                  </li>
                  <li className="flex gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    <span>{t("secretChat.warning2")}</span>
                  </li>
                  <li className="flex gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="m11 8-4 4"/></svg>
                    <span>{t("secretChat.warning3")}</span>
                  </li>
                  <li className="flex gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0 mt-0.5"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    <span>{t("secretChat.warning4")}</span>
                  </li>
                </ul>
                <div className="flex gap-2 justify-end mt-5">
                  <button
                    type="button"
                    onClick={() => setShowSecretChatWarning(false)}
                    disabled={secretChatCreating}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={secretChatCreating}
                    onClick={async () => {
                      if (!chat.other_member) return;
                      setSecretChatCreating(true);
                      try {
                        const { data: secretChat } = await chatsApi.getOrCreateDm(chat.other_member.id, { is_secret: true });
                        setShowSecretChatWarning(false);
                        useChatListStore.getState().upsertChat(secretChat);
                        if (onNavigateToChat) onNavigateToChat(secretChat.id);
                      } catch {
                        setShowSecretChatWarning(false);
                      } finally {
                        setSecretChatCreating(false);
                      }
                    }}
                    className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium transition-colors"
                  >
                    {secretChatCreating ? t("createChat.creating") : t("secretChat.confirm")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: chat photo editing */}
        {editingAvatar && chat && !chat.is_personal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setEditingAvatar(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 flex justify-end">
                <button type="button" onClick={() => setEditingAvatar(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100" aria-label={t("common.close")}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <div className="px-6 pb-2 flex flex-col items-center">
                {chat.avatar_url ? (
                  <MediaImage source={chat.avatar_url} alt={t("chat.chatPhoto")} className="w-48 h-48 rounded-2xl object-cover mb-6" lazy={false} />
                ) : (
                  <div className="w-48 h-48 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button type="button" onClick={() => { handleRemoveAvatar(); setEditingAvatar(false); }} disabled={avatarUploading || !chat.avatar_url} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200 disabled:opacity-50 disabled:pointer-events-none text-sm font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    {t("common.delete")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingAvatar(false); setShowAvatarEditor(true); }}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                    title={t("chat.cropDrawText")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    {t("chat.edit")}
                  </button>
                  <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm font-medium col-span-2">
                    {avatarUploading ? <span>Загрузка...</span> : (<><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Заменить</>)}
                  </button>
                  {/* TODO: Generate chat avatar with AI — API integration, style/prompt selection, upload result as avatar */}
                  <button
                    type="button"
                    onClick={() => alert(t("chat.featureInDev"))}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-100 text-sm font-medium col-span-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                    Сгенерировать с помощью ИИ
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Photo confirmation step: circle crop, scale, shift — after file selection */}
        {pendingAvatarFile && chat && (
          <AvatarCropConfirmModal
            file={pendingAvatarFile}
            onConfirm={handleAvatarCropConfirm}
            onCancel={() => setPendingAvatarFile(null)}
          />
        )}
        {/* Avatar editor: crop, draw, text */}
        {showAvatarEditor && chat && (
          <AvatarEditorModal
            imageUrl={chatAvatarResolvedUrl ? (toSameOriginMediaUrl(chatAvatarResolvedUrl) || chatAvatarResolvedUrl) : null}
            onSave={handleAvatarSaveFromEditor}
            onCancel={() => setShowAvatarEditor(false)}
          />
        )}
        {/* Fullscreen avatar view */}
        {showAvatarFullscreen && fullscreenAvatarResolvedUrl && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setShowAvatarFullscreen(null)}
            role="button"
            tabIndex={-1}
            aria-label={t("common.close")}
          >
            <img
              src={fullscreenAvatarResolvedUrl}
              alt={t("chat.fullPhoto")}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setShowAvatarFullscreen(null)}
              className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full hover:bg-white/10"
              aria-label={t("common.close")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Info sidebar — full-screen overlay on mobile, side panel on desktop */}
      {showInfo && (
        <>
          {/* Backdrop (mobile only): tap to close */}
          <div
            className={`fixed inset-0 z-40 bg-black/30 ${shouldReplaceChatWithInfo ? "" : "md:hidden"}`}
            onClick={() => setShowInfo(false)}
            aria-hidden
          />
          <aside
            className={`
              flex flex-col overflow-y-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))] backdrop-blur
              ${shouldReplaceChatWithInfo
                ? "fixed z-50 border-l border-slate-200/70"
                : "fixed inset-0 z-50 md:static md:inset-auto md:z-auto md:w-80 md:border-l md:border-slate-200/70 md:shrink-0"}
            `}
            style={shouldReplaceChatWithInfo && chatAreaBounds
              ? {
                  top: chatAreaBounds.top,
                  left: chatAreaBounds.left,
                  width: chatAreaBounds.width,
                  height: chatAreaBounds.height,
                }
              : undefined}
          >
            <div className="relative z-10 flex h-16 shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/88 px-3 backdrop-blur">
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                className={`${shouldReplaceChatWithInfo ? "" : "md:hidden "}p-2 -ml-1 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color] shrink-0`}
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <div className="relative shrink-0" ref={infoMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowInfoMenu((v) => !v)}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 active:scale-[0.98] transition-[transform,background-color,color]"
                  aria-label={t("messenger.menu")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
                {showInfoMenu && (() => {
                    if (!chat) return null;
                    const isPersonal = chat.is_personal;
                    const myMembership = activeMembers.find((m) => m.user.id === myUserId);
                    const adminsCount = activeMembers.filter((m) => m.role === "admin").length;
                    const amIOnlyAdmin = !isPersonal && myMembership?.role === "admin" && adminsCount <= 1;
                    const btnCls = "w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50/80 disabled:opacity-50 flex items-center gap-3";
                    const btnClsRed = "w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50/80 disabled:opacity-50 flex items-center gap-3";
                    return (
                      <div className="absolute left-0 top-full mt-2 py-1 min-w-[220px] bg-white rounded-2xl border border-slate-200/70 shadow-xl z-50">
                        {isPersonal && !chat.is_secret && isStandalone() && (
                          <button type="button" onClick={() => { setShowInfoMenu(false); setShowSecretChatWarning(true); }} className={btnCls}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-600"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            {t("secretChat.createTitle")}
                          </button>
                        )}
                        {isPersonal ? (
                          <button type="button" onClick={() => { handleLeaveChat(); setShowInfoMenu(false); }} disabled={leaveLoading} className={btnCls}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Очистить чат
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setShowInfoMenu(false);
                              if (!amIOnlyAdmin) handleLeaveChat();
                            }}
                            disabled={leaveLoading || amIOnlyAdmin}
                            className={btnCls}
                            title={amIOnlyAdmin ? t("chat.assignAdminFirst") : undefined}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                            Выйти из чата
                          </button>
                        )}
                        {isMuted ? (
                          <button type="button" onClick={() => { handleMute("off"); setShowInfoMenu(false); }} disabled={muteLoading} className={btnCls}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                            {t("messenger.enableNotif")}
                          </button>
                        ) : (
                          <div
                            ref={muteFlyoutAnchorRef}
                            className="relative"
                            onMouseEnter={openMuteFlyout}
                            onMouseLeave={scheduleCloseMuteFlyout}
                          >
                            <button
                              type="button"
                              disabled={muteLoading}
                              className={btnCls + " justify-between"}
                              onClick={() => {
                                if (showMuteFlyout) closeMuteFlyout();
                                else openMuteFlyout();
                              }}
                            >
                              <span className="flex items-center gap-3">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                {t("messenger.mute")}
                              </span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><path d="m9 18 6-6-6-6"/></svg>
                            </button>
                          </div>
                        )}
                        {showMuteFlyout && muteFlyoutPos && createPortal(
                          <div
                            ref={muteFlyoutRef}
                            className="fixed z-[60] min-w-[160px] py-1 bg-white border border-slate-200 rounded-lg shadow-lg"
                            style={{ left: muteFlyoutPos.left, top: muteFlyoutPos.top }}
                            onMouseEnter={openMuteFlyout}
                            onMouseLeave={scheduleCloseMuteFlyout}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {(["1h", "3h", "8h", "forever"] as const).map((dur) => (
                              <button
                                key={dur}
                                type="button"
                                onClick={() => {
                                  handleMute(dur);
                                  setShowInfoMenu(false);
                                  closeMuteFlyout();
                                }}
                                disabled={muteLoading}
                                className={btnCls}
                              >
                                {t(dur === "1h" ? "messenger.muteFor1h" : dur === "3h" ? "messenger.muteFor3h" : dur === "8h" ? "messenger.muteFor8h" : "messenger.muteForever")}
                              </button>
                            ))}
                          </div>,
                          document.body,
                        )}
                        {chat.owner?.id === myUserId && (
                          <button type="button" onClick={() => { handleDeleteChat(); setShowInfoMenu(false); }} disabled={deleteLoading} className={btnClsRed}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            {t("common.delete")}
                          </button>
                        )}
                        {!isPersonal && !chat.is_favorites && chat.owner?.id === myUserId && (
                          <div className="px-4 py-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                            <p className="text-xs text-slate-500 mb-1.5">{t("chat.slowMode")}</p>
                            <select
                              value={chat.slow_mode_seconds ?? 0}
                              onChange={(e) => {
                                handleSlowModeChange(Number(e.target.value));
                              }}
                              disabled={savingChat}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                              <option value={0}>{t("chat.slowModeOff")}</option>
                              <option value={1}>{t("chat.slowMode1s")}</option>
                              <option value={5}>{t("chat.slowMode5s")}</option>
                              <option value={15}>{t("chat.slowMode15s")}</option>
                              <option value={60}>{t("chat.slowMode60s")}</option>
                              <option value={300}>{t("chat.slowMode300s")}</option>
                            </select>
                          </div>
                        )}
                        {chat.owner?.id === myUserId && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowInfoMenu(false);
                              setShowInfo(true);
                              setTimeout(() => backgroundInputRef.current?.click(), 200);
                            }}
                            className={btnCls}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                            Изменить фон
                          </button>
                        )}
                        {channelId && hasChannelAuthorRole && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowInfoMenu(false);
                              setShowImportTelegramModal(true);
                            }}
                            className={btnCls}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            {t("channelImport.menuItem")}
                          </button>
                        )}
                        {chatId && !channelId && (canInviteToGroup || !!chat?.is_personal) && !chat?.is_favorites && (
                          chat?.has_telegram_import ? (
                            <button
                              type="button"
                              onClick={() => { setShowInfoMenu(false); setShowManageImportModal(true); }}
                              className={btnCls}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                              {t("channelImport.manageMenuItem")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setShowInfoMenu(false); setShowImportTelegramChatModal(true); }}
                              className={btnCls}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              {t("channelImport.menuItem")}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })()}
              </div>
              <h2 className="min-w-0 flex-1 truncate text-center text-[1.05rem] font-semibold text-slate-800">{t("chat.aboutChat")}</h2>
              <button type="button" onClick={() => setShowInfo(false)} className="shrink-0 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100/80 hover:text-slate-600">&#10005;</button>
            </div>

            {/* ===== User profile view ===== */}
            {infoUserId && (() => {
              const member = activeMembers.find((m) => m.user.id === infoUserId);
              const profileUser = member?.user ?? (chat?.is_personal && chat?.other_member?.id === infoUserId ? chat.other_member : null);
              if (!profileUser) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                    <p className="text-sm">Пользователь не найден</p>
                    <button type="button" onClick={() => setInfoUserId(null)} className="mt-3 text-sm text-blue-600 hover:text-blue-800 hover:underline">Назад к чату</button>
                  </div>
                );
              }
              const avatarUrl = (profileUser as User).avatar_url ?? (profileUser as User).avatar ?? null;
              const name = userDisplayName(profileUser as User);
              const isOnline = onlineStatus[profileUser.id]?.is_online;
              const lastSeen = onlineStatus[profileUser.id]?.last_seen_display;
              const isMe = profileUser.id === myUserId;
              const isImage = (msg: Message) => {
                if (msg.msg_type === "image") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("image/"));
              };
              const isVideo = (msg: Message) => {
                if (msg.msg_type === "audio") return false;
                if (msg.msg_type === "video_circle") return false;
                if (msg.msg_type === "video") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("video/"));
              };
              const isCircle = (msg: Message) => msg?.msg_type === "video_circle" && !!msg.file;
              const isAudioMsg = (msg: Message) => {
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!msg?.file && (msg.msg_type === "audio" || (!!mime && mime.startsWith("audio/")));
              };
              const isImageOrVideo = (msg: Message) => isImage(msg) || isVideo(msg);
              const mediaCount = messages.filter((m) => m && isImageOrVideo(m)).length;
              const filesCount = messages.filter((m) => {
                if (!m || !m.file) return false;
                if (isImageOrVideo(m)) return false;
                if (isAudioMsg(m)) return false;
                if (isCircle(m)) return false;
                return m.msg_type === "file" || (m.file && typeof m.file === "object");
              }).length;
              return (
                <div className="flex-1 overflow-y-auto px-3 py-3">
                  {/* Back to chat info */}
                  <div className="mb-3 rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <button
                      type="button"
                      onClick={() => setInfoUserId(null)}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                      {t("chat.backToChat")}
                    </button>
                  </div>

                  {/* Avatar + name */}
                  <div className="flex flex-col items-center rounded-[28px] border border-slate-200/80 bg-white/90 px-4 pb-4 pt-4 shadow-[0_18px_38px_rgba(15,23,42,0.05)]">
                    <div className="relative">
                      {avatarUrl ? (
                        <button
                          type="button"
                          onClick={() => setShowAvatarFullscreen(avatarUrl)}
                          className="block rounded-full overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                          title={t("chat.viewPhoto")}
                        >
                          <MediaImage
                            source={getAvatarUrlBySize(avatarUrl, (profileUser as User).avatar_url_small, (profileUser as User).avatar_url_medium, "medium")}
                            alt=""
                            className="w-20 h-20 rounded-full object-cover"
                            lazy={false}
                          />
                        </button>
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
                          {name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?"}
                        </div>
                      )}
                      {isOnline && (
                        <span className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full" />
                      )}
                    </div>

                    <h3 className="font-semibold text-slate-800 text-center mt-2 flex items-center justify-center gap-1.5 flex-wrap">
                      {name}
                      {(profileUser as User).status_emoji && (
                        <span className="text-xl shrink-0" aria-hidden>{(profileUser as User).status_emoji}</span>
                      )}
                    </h3>

                    {/* Online status */}
                    <p className="text-xs mt-0.5">
                      {isOnline ? (
                        <span className="text-green-500 font-medium">{t("chat.online")}</span>
                      ) : lastSeen ? (
                        <span className="text-slate-500">{formatLastSeen(lastSeen, lang)}</span>
                      ) : null}
                    </p>

                    {/* Bio — visible to all visitors */}
                    {(profileUser as User).bio && (
                      <p className="mt-2 text-sm text-slate-600 text-center max-w-xs mx-auto whitespace-pre-wrap break-words">
                        {(profileUser as User).bio}
                      </p>
                    )}

                    {/* Username & phone */}
                    {((profileUser as User).username || profileUser.phone) && (
                      <div className="mt-2 flex flex-col items-center gap-0.5 text-xs text-slate-500">
                        {(profileUser as User).username && (
                          isMe ? (
                            <button
                              type="button"
                              onClick={() => {
                                const link = `${window.location.origin}/chats?write=${encodeURIComponent((profileUser as User).username!)}`;
                                if (navigator.clipboard?.writeText) {
                                  navigator.clipboard.writeText(link).then(() => {
                                    setProfileUsernameLinkCopied(true);
                                    setTimeout(() => setProfileUsernameLinkCopied(false), 2000);
                                  });
                                }
                              }}
                              className="font-medium text-blue-600 hover:underline cursor-pointer"
                              title={t("settings.copyUsernameLink")}
                            >
                              {profileUsernameLinkCopied ? t("common.copied") : `@${(profileUser as User).username}`}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const text = `@${(profileUser as User).username}`;
                                if (navigator.clipboard?.writeText) {
                                  navigator.clipboard.writeText(text).then(() => {
                                    setUsernameCopied(true);
                                    setTimeout(() => setUsernameCopied(false), 2000);
                                  });
                                }
                              }}
                              className="font-medium text-blue-600 hover:underline cursor-pointer text-left"
                              title={t("common.copy")}
                            >
                              {usernameCopied ? t("common.copied") : `@${(profileUser as User).username}`}
                            </button>
                          )
                        )}
                        {profileUser.phone && (
                          <span className="text-slate-600">{profileUser.phone}</span>
                        )}
                      </div>
                    )}

                    {/* Personal channel — only if user added it to their profile */}
                    {(profileUser as User).personal_channel && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">{t("settings.personalChannel")}</p>
                        <Link
                          to={`/channel/${(profileUser as User).personal_channel!.id}`}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {(profileUser as User).personal_channel!.title}
                          {(profileUser as User).personal_channel!.title_icon && <span className="ml-1" aria-hidden>{(profileUser as User).personal_channel!.title_icon}</span>}
                          {(profileUser as User).personal_channel!.username && <span className="text-slate-500 ml-1">@{(profileUser as User).personal_channel!.username}</span>}
                        </Link>
                      </div>
                    )}

                    {/* Add to contacts (Telegram-style) — only for other users */}
                    {!isMe && (() => {
                      const currentContact = contacts.find((c) => c.contact_user.id === profileUser.id);
                      const isEditing = editingContactId === profileUser.id;
                      return (
                        <div className="mt-4 w-full">
                          <div className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/92 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                            {currentContact ? (
                              <>
                                {isEditing ? (
                                  <div className="p-3 space-y-2">
                                    <input
                                      type="text"
                                      value={contactNameDraft}
                                      onChange={(e) => setContactNameDraft(e.target.value.slice(0, 255))}
                                      placeholder={t("chat.contactNamePlaceholder")}
                                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                      autoFocus
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingContactId(null);
                                          setContactNameDraft("");
                                        }}
                                        className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                                      >
                                        {t("common.cancel")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const v = contactNameDraft.trim();
                                          if (!v) return;
                                          setContactSaving(true);
                                          try {
                                            await contactsApi.update(currentContact.id, v);
                                            const [listRes, chatRes] = await Promise.all([contactsApi.list(), chatId ? chatsApi.get(chatId) : null]);
                                            setContacts(listRes.data);
                                            if (chatRes) setChat(chatRes.data);
                                            setEditingContactId(null);
                                            setContactNameDraft("");
                                          } finally {
                                            setContactSaving(false);
                                          }
                                        }}
                                        disabled={contactSaving || !contactNameDraft.trim()}
                                        className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50"
                                      >
                                        {contactSaving ? "…" : t("common.save")}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-3 flex flex-col gap-2">
                                    <p className="text-xs text-slate-500">{t("chat.contactNamePlaceholder")}: {currentContact.local_name}</p>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingContactId(profileUser.id);
                                          setContactNameDraft(currentContact.local_name);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                                      >
                                        {t("chat.editContact")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setContactSaving(true);
                                          try {
                                            await contactsApi.delete(currentContact.id);
                                            const [listRes, chatRes] = await Promise.all([contactsApi.list(), chatId ? chatsApi.get(chatId) : null]);
                                            setContacts(listRes.data);
                                            if (chatRes) setChat(chatRes.data);
                                          } finally {
                                            setContactSaving(false);
                                          }
                                        }}
                                        disabled={contactSaving}
                                        className="text-xs text-red-600 hover:text-red-800 px-2 py-1 disabled:opacity-50"
                                      >
                                        {t("chat.removeFromContacts")}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : isEditing ? (
                              <div className="p-3 space-y-2">
                                <input
                                  type="text"
                                  value={contactNameDraft}
                                  onChange={(e) => setContactNameDraft(e.target.value.slice(0, 255))}
                                  placeholder={t("chat.contactNamePlaceholder")}
                                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingContactId(null);
                                      setContactNameDraft("");
                                    }}
                                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                                  >
                                    {t("common.cancel")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const v = contactNameDraft.trim();
                                      if (!v) return;
                                        setContactSaving(true);
                                        try {
                                          await contactsApi.create(profileUser.id, v);
                                          const [listRes, chatRes] = await Promise.all([contactsApi.list(), chatId ? chatsApi.get(chatId) : null]);
                                          setContacts(listRes.data);
                                          if (chatRes) setChat(chatRes.data);
                                          setEditingContactId(null);
                                          setContactNameDraft("");
                                        } finally {
                                          setContactSaving(false);
                                        }
                                    }}
                                    disabled={contactSaving || !contactNameDraft.trim()}
                                    className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50"
                                  >
                                    {contactSaving ? "…" : t("common.save")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingContactId(profileUser.id);
                                  setContactNameDraft(userDisplayName(profileUser as User));
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
                                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                </svg>
                                <span className="flex-1 min-w-0 text-sm text-slate-800">{t("chat.addToContacts")}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Media / Files shortcuts (Telegram-like) */}
                    <div className="mt-4 w-full">
                      <div className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/92 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <button
                          type="button"
                          onClick={() => { setInfoUserId(null); setMediaLinksFilesTab("media"); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="m21 15-5-5L5 21" />
                          </svg>
                          <span className="flex-1 min-w-0 text-sm text-slate-800">{t("chat.media")}</span>
                          <span className="text-xs text-slate-500 tabular-nums">{mediaCount}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </button>
                        <div className="h-px bg-slate-200" />
                        <button
                          type="button"
                          onClick={() => { setInfoUserId(null); setMediaLinksFilesTab("files"); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="flex-1 min-w-0 text-sm text-slate-800">{t("chat.files")}</span>
                          <span className="text-xs text-slate-500 tabular-nums">{filesCount}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="px-1 pb-1 pt-4 space-y-2">
                    {!isMe && onOpenDmWithUserId && (
                      <button
                        type="button"
                        onClick={() => onOpenDmWithUserId(profileUser.id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm font-medium transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        {t("common.write")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ===== Chat info view (when not showing a user profile) ===== */}
            {!infoUserId && chat && (
            <>
            {(leaveError || deleteError) && (
              <div className="px-4 py-2 border-b bg-red-50 border-red-100">
                <p className="text-xs text-red-600">{leaveError || deleteError}</p>
              </div>
            )}

            {/* Avatar */}
            <div className="mx-3 mb-3 rounded-[28px] border border-slate-200/80 bg-white/90 px-5 pb-5 pt-4 shadow-[0_18px_38px_rgba(15,23,42,0.05)]">
              <div className="flex flex-col items-center">
              <div className="relative group">
                {chat.is_favorites ? (
                  <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                ) : (chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                  <button
                    type="button"
                    onClick={() => setShowAvatarFullscreen(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!)}
                    className="block rounded-full overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    title={t("chat.viewPhoto")}
                  >
                    <MediaImage
                      source={getAvatarUrlBySize(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!, chat.is_personal && chat.other_member ? chat.other_member!.avatar_url_medium : chat.avatar_url_medium, chat.is_personal && chat.other_member ? chat.other_member!.avatar_url_medium : chat.avatar_url_medium, "medium")}
                      alt=""
                      className="w-20 h-20 rounded-full object-cover"
                      lazy={false}
                    />
                  </button>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
                    {chat.is_personal && chat.other_member
                      ? userDisplayName(chat.other_member).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?"
                      : (chat.title || "Ч").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "Ч"}
                  </div>
                )}
                {chat.owner?.id === myUserId && !chat.is_personal && !chat.is_favorites && (
                  <button type="button" onClick={() => setEditingAvatar(true)} className="absolute bottom-0 right-0 w-7 h-7 bg-slate-600 text-white rounded-full flex items-center justify-center shadow hover:bg-slate-700 transition-colors" title={t("chat.editPhoto")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                )}
                {chat.is_personal && chat.other_member && onlineStatus[chat.other_member.id]?.is_online && (
                  <span className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full" />
                )}
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileSelect} />
              </div>
              {editingTitle ? (
                <div className="w-full mt-2 space-y-1">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value.slice(0, 50))}
                    maxLength={50}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-800 text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                    autoFocus
                    placeholder={t("chat.chatNamePlaceholder")}
                  />
                  {titleDraft.length >= 30 && (
                    <p className="text-xs text-slate-500 text-center">{titleDraft.length}/50</p>
                  )}
                  <div className="flex gap-2 justify-center">
                    <button type="button" onClick={() => { setEditingTitle(false); setTitleDraft(chat.title || ""); }} className="text-xs text-slate-500 hover:text-slate-700">Отмена</button>
                    <button type="button" onClick={handleSaveTitle} disabled={savingChat || !titleDraft.trim()} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">{savingChat ? "..." : t("common.save")}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 mt-2">
                  {chat.owner?.id === myUserId && !chat.is_personal && !chat.is_favorites ? (
                    <button
                      type="button"
                      onClick={() => { setTitleDraft(chat.title || ""); setEditingTitle(true); }}
                      className="font-semibold text-slate-800 text-center flex items-center justify-center gap-1 hover:bg-slate-100 rounded px-1 -mx-1 py-0.5 transition-colors"
                      title={t("chat.editChatName")}
                    >
                      {chat.title}
                      {chat.title_icon && <span className="shrink-0" aria-hidden>{chat.title_icon}</span>}
                    </button>
                  ) : (
                    <h3 className="font-semibold text-slate-800 text-center flex items-center justify-center gap-1">
                      {chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? userDisplayName(chat.other_member) : chat.title}
                      {chat.title_icon && <span className="shrink-0" aria-hidden>{chat.title_icon}</span>}
                    </h3>
                  )}
                  {chat.owner?.id === myUserId && !chat.is_personal && !chat.is_favorites && (
                    <button type="button" onClick={() => { setTitleDraft(chat.title || ""); setEditingTitle(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0" title={t("chat.editChatName")}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                  )}
                </div>
              )}
              {chat.is_personal && chat.other_member && (
                <>
                <p className="text-xs mt-0.5">
                  {onlineStatus[chat.other_member.id]?.is_online ? (
                    <span className="text-green-500 font-medium">{t("chat.online")}</span>
                  ) : (
                    <span className="text-slate-500">{formatLastSeen(onlineStatus[chat.other_member.id]?.last_seen_display, lang)}</span>
                  )}
                </p>
                {(chat.other_member.username || chat.other_member.phone) && (
                  <div className="mt-1.5 flex flex-col items-center gap-0.5 text-xs text-slate-500">
                    {chat.other_member.username && (
                      <span>
                        <button
                          type="button"
                          onClick={() => {
                            const un = chat.other_member?.username;
                            if (un && navigator.clipboard?.writeText) {
                              const text = `@${un}`;
                              navigator.clipboard.writeText(text).then(() => {
                                setUsernameCopied(true);
                                setTimeout(() => setUsernameCopied(false), 2000);
                              });
                            }
                            if (onOpenDmWithUserId && chat.other_member?.id) {
                              setUsernameShake(true);
                              setTimeout(() => setUsernameShake(false), 400);
                            }
                          }}
                          className={`text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer ${usernameShake ? "animate-username-shake" : ""}`}
                          title={t("common.copy")}
                        >
                          {usernameCopied ? t("common.copied") : `@${chat.other_member?.username}`}
                        </button>
                      </span>
                    )}
                    {chat.other_member.phone && (
                      <span className="text-slate-600">{chat.other_member.phone}</span>
                    )}
                  </div>
                )}
                </>
              )}
              {!chat.is_personal && !chat.is_favorites && (
                <p className="text-xs text-slate-500">{formatMembersCount(activeMembers.length > 0 ? activeMembers.length : chat.members_count, lang)}</p>
              )}
              {/* Group tier badge + group age — groups only */}
              {!chat.is_personal && !chat.is_favorites && (() => {
                const label = t("chat.group");
                const hint = t("chat.upTo10k");
                const colors = "bg-slate-100 text-slate-600";
                const created = new Date(chat.created_at).getTime();
                const days = Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
                const ageStr = days < 31
                  ? (days === 0 ? t("misc.lessThanDay") : days === 1 ? t("misc.oneDay") : days < 5 ? `${days} дня` : `${days} дн.`)
                  : days < 365
                    ? (() => { const m = Math.floor(days / 30); return m === 1 ? "1 мес." : `${m} мес.`; })()
                    : (() => { const y = Math.floor(days / 365); return y === 1 ? "1 год" : y < 5 ? `${y} года` : `${y} лет`; })();
                return (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colors}`}>
                      <span>{label}</span>
                      <span className="relative group/tip cursor-help">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity shadow-lg">
                          {hint}
                        </span>
                      </span>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{ageStr}</span>
                  </div>
                );
              })()}
              </div>
            </div>

            {/* Быстрые действия — только для личного чата: одна строка, равные квадраты */}
            {chat.is_personal && chat.other_member && (
              <div className="mx-3 mb-3 rounded-[24px] border border-slate-200/80 bg-white/90 p-3 shadow-[0_14px_28px_rgba(15,23,42,0.04)]">
              <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                <button
                  type="button"
                  onClick={() => setShowInfo(false)}
                  className="aspect-square flex flex-col items-center justify-center gap-1 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors min-w-0"
                  title={t("common.write")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span className="text-[0.625rem] font-medium leading-tight truncate w-full px-0.5 text-center">{t("common.write")}</span>
                </button>
                {contacts.find((c) => c.contact_user.id === chat.other_member!.id) ? (
                  <span className="aspect-square flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-slate-600 min-w-0" title={t("chat.inContacts")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span className="text-[0.625rem] font-medium leading-tight truncate w-full px-0.5 text-center">{t("chat.inContacts")}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={contactSaving}
                    onClick={async () => {
                      setContactSaving(true);
                      try {
                        await contactsApi.create(chat.other_member!.id, userDisplayName(chat.other_member!));
                        const [listRes] = await Promise.all([contactsApi.list()]);
                        setContacts(listRes.data);
                      } catch {}
                      setContactSaving(false);
                    }}
                    className="aspect-square flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50 min-w-0"
                    title={t("chat.addToContacts")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span className="text-[0.625rem] font-medium leading-tight truncate w-full px-0.5 text-center">{contactSaving ? "…" : t("chat.addToContacts")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const url = window.location.href;
                    const name = userDisplayName(chat.other_member!);
                    const text = (chat.other_member!.username ? `@${chat.other_member!.username}` : "") || (chat.other_member!.phone || "");
                    if (navigator.share) {
                      try {
                        await navigator.share({ title: name, text: text || undefined, url });
                      } catch {}
                    } else if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(url);
                      setUsernameCopied(true);
                      setTimeout(() => setUsernameCopied(false), 2000);
                    }
                  }}
                  className="aspect-square flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors min-w-0"
                  title={t("chat.share")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  <span className="text-[0.625rem] font-medium leading-tight truncate w-full px-0.5 text-center">{t("chat.share")}</span>
                </button>
              </div>
              </div>
            )}

            {!chat.is_personal && !chat.is_favorites && (
            <div className="mx-3 mb-3 rounded-[24px] border border-slate-200/80 bg-white/90 px-5 py-4 shadow-[0_14px_28px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Описание</span>
                  {chat.owner?.id === myUserId && !editingDescription && (
                    <button type="button" onClick={() => { setDescriptionDraft(chat.description || ""); setEditingDescription(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 rounded" title={t("chat.editDescription")}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                  )}
                </div>
                {editingDescription ? (
                  <div className="mt-1">
                    <textarea
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                      rows={3}
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value.replace(/\n{2,}/g, "\n").slice(0, 100))}
                      maxLength={100}
                      autoFocus
                      placeholder={t("chat.descPlaceholder")}
                    />
                    <p className="text-xs text-slate-500 text-right mt-0.5">{descriptionDraft.length}/100</p>
                    <div className="flex gap-2 mt-1 justify-end">
                      <button type="button" onClick={() => setEditingDescription(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Отмена</button>
                      <button type="button" onClick={handleSaveDescription} disabled={savingChat} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">{savingChat ? "..." : t("common.save")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 min-w-0 overflow-hidden">
                    {chat.owner?.id === myUserId ? (
                      <button
                        type="button"
                        onClick={() => { setDescriptionDraft(chat.description || ""); setEditingDescription(true); }}
                        className="w-full text-left rounded px-1 -mx-1 py-0.5 hover:bg-slate-100 transition-colors min-w-0"
                      >
                        {chat.description ? (
                          (() => {
                            const cleaned = chat.description.replace(/\n{2,}/g, "\n").trim();
                            const lineCount = cleaned.split("\n").length;
                            return (
                              <p className={`text-sm text-slate-700 whitespace-pre-wrap break-words break-all ${lineCount > 5 ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>{cleaned}</p>
                            );
                          })()
                        ) : (
                          <p className="text-sm text-slate-400 italic">Нет описания</p>
                        )}
                      </button>
                    ) : (
                      <>
                        {chat.description ? (
                          (() => {
                            const cleaned = chat.description.replace(/\n{2,}/g, "\n").trim();
                            const lineCount = cleaned.split("\n").length;
                            return (
                              <p className={`text-sm text-slate-700 whitespace-pre-wrap break-words break-all ${lineCount > 5 ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>{cleaned}</p>
                            );
                          })()
                        ) : (
                          <p className="text-sm text-slate-400 italic">Нет описания</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Hidden input for "Change background" from the three-dot menu */}
            {chat.owner?.id === myUserId && (
              <div className="hidden" aria-hidden="true">
                <input ref={backgroundInputRef} type="file" accept="image/*" onChange={handleBackgroundUpload} disabled={backgroundUploading} />
              </div>
            )}

            {/* Type and invite link — groups only */}
            {!chat.is_personal && !chat.is_favorites && (
            <div className="space-y-2 px-5">
              {chat.chat_type != null && (
              <div><span className="text-xs text-slate-400 uppercase tracking-wide">{t("chat.type")}</span><p className="text-slate-700">{chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}</p></div>
              )}
              {chat.invite_link && (
                <div>
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Пригласительная ссылка</span>
                  <div className={`flex items-center gap-2 mt-1 flex-wrap ${inviteCopyShake ? "animate-username-shake" : ""}`}>
                    <code className="text-xs bg-slate-100 rounded px-2 py-1 text-slate-600 truncate flex-1 min-w-0">{normalizeInviteLink(chat.invite_link)}</code>
                    <button type="button" onClick={handleCopy} className="text-xs px-2 py-1 rounded transition-colors bg-blue-100 text-blue-600 hover:bg-blue-200 shrink-0">
                      {t("common.copy")}
                    </button>
                    {copiedState && (
                      <span className="text-xs text-green-600 font-medium shrink-0">{t("common.copied")}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

          <div className="p-3">
            {/* Media, Links, Files; in groups — Members tab */}
            {(() => {
              // A group of 2 people stays a group chat (title, avatar, blocks, "N members" label). Personal only when chat.is_personal.
              const isGroup = !chat.is_personal;
              const isImage = (msg: Message) => {
                if (msg.msg_type === "image") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("image/"));
              };
              const isVideo = (msg: Message) => {
                if (msg.msg_type === "audio") return false;
                if (msg.msg_type === "video_circle") return false;
                if (msg.msg_type === "video") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("video/"));
              };
              const isCircle = (msg: Message) => msg?.msg_type === "video_circle" && !!msg.file;
              const isAudioMsg = (msg: Message) => {
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!msg?.file && (msg.msg_type === "audio" || (!!mime && mime.startsWith("audio/")));
              };
              const isImageOrVideo = (msg: Message) => isImage(msg) || isVideo(msg);
              const mediaMessages = messages.filter((m) => m && isImageOrVideo(m));
              const urlRe = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
              const linkMessages = messages.filter((m) => m?.content && urlRe.test(m.content));
              const voiceMessages = messages.filter((m) => m && isAudioMsg(m));
              const circleMessages = messages.filter((m) => m && isCircle(m));
              const fileMessages = messages.filter((m) => {
                if (!m || !m.file) return false;
                if (isImageOrVideo(m)) return false;
                if (isAudioMsg(m)) return false;
                if (isCircle(m)) return false;
                return m.msg_type === "file" || (m.file && typeof m.file === "object");
              });
              const thumbUrl = (msg: Message) => {
                const f = msg.file && typeof msg.file === "object" && "url" in msg.file ? (msg.file as { url?: string }).url : null;
                const files = (msg.files ?? []) as { url?: string }[];
                return f || files[0]?.url;
              };
              const showParticipants = isGroup && !chat.is_favorites;
              const tabs: { id: "media" | "links" | "files" | "voice" | "participants"; label: string }[] = showParticipants
                ? [
                    { id: "participants" as const, label: t("chat.participants") },
                    { id: "media", label: t("chat.media") },
                    { id: "voice", label: t("chat.voiceMessages") },
                    { id: "links", label: t("chat.links") },
                    { id: "files", label: t("chat.files") },
                  ]
                : [
                    { id: "media", label: t("chat.media") },
                    { id: "voice", label: t("chat.voiceMessages") },
                    { id: "links", label: t("chat.links") },
                    { id: "files", label: t("chat.files") },
                  ];
              return (
                <div className="mt-3 pt-2">
                  <div className="flex border-b border-slate-200 -mb-px flex-nowrap gap-0 overflow-x-auto scrollbar-hide">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMediaLinksFilesTab(t.id)}
                        className={`shrink-0 px-2 sm:px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                          mediaLinksFilesTab === t.id
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="pt-2">
                    {mediaLinksFilesTab === "participants" && showParticipants && (
                      <div className="space-y-4">
                        {canInviteToGroup && (
                          <div className="mb-4">
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Пригласить по username</label>
                            <input
                              type="text"
                              placeholder={t("chat.enterUsername")}
                              value={inviteSearchQuery}
                              onChange={(e) => setInviteSearchQuery(e.target.value)}
                              className="w-full px-3 py-2.5 text-sm rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                              style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                            />
                            {inviteError && <p className="text-red-500 text-xs mt-1">{inviteError}</p>}
                            {inviteSearchLoading && <p className="text-slate-500 text-xs mt-1">Поиск...</p>}
                            {inviteSearchResults.length > 0 && (
                              <ul
                                className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded-2xl p-2 backdrop-blur"
                                style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}
                              >
                                {inviteSearchResults
                                  .filter((u) => !activeMembers.some((m) => m.user.id === u.id))
                                  .map((u) => (
                                    <li key={u.id}>
                                      <button
                                        type="button"
                                        disabled={inviteLoading}
                                        onClick={() => handleInviteUser(u.id)}
                                        className="w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors hover:bg-slate-100/70 disabled:opacity-50"
                                      >
                                        <span className="font-medium truncate" style={{ color: "var(--text-0)" }}>{userDisplayName(u) || u.username || u.id}</span>
                                        {u.username && <span className="truncate" style={{ color: "var(--text-2)" }}>@{u.username}</span>}
                                        <span className="ml-auto text-xs font-medium" style={{ color: "#2563eb" }}>
                                          {inviteLoading ? "…" : t("chat.add")}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>
                        )}
                        <ul className="space-y-2">
                          {activeMembers.map((m) => {
                            const isMe = m.user.id === myUserId;
                            const openDm = !isMe && onOpenDmWithUserId ? () => onOpenDmWithUserId(m.user.id) : undefined;
                            return (
                              <li key={m.id} className="flex items-center gap-3">
                                <Link
                                  to={buildUserInfoHref(m.user)}
                                  className="relative shrink-0 rounded-full hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                                  title={t("chat.personInfo")}
                                >
                                  <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-semibold">{getAvatarInitials(userDisplayName(m.user))}</div>
                                  {onlineStatus[m.user.id]?.is_online && (
                                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
                                  )}
                                </Link>
                                <div className="flex-1 min-w-0">
                                  {openDm ? (
                                    <button type="button" onClick={openDm} className="text-left w-full min-w-0 block truncate text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
                                      {userDisplayName(m.user)}
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => setInfoUserId(m.user.id)} className="text-left w-full min-w-0 block truncate text-sm text-slate-800 hover:text-blue-600 font-medium">
                                      {userDisplayName(m.user)}
                                    </button>
                                  )}
                                  {m.user.username ? (
                                    openDm ? (
                                      <button type="button" onClick={openDm} className="text-xs text-blue-500 hover:text-blue-700 hover:underline truncate block">
                                        @{m.user.username}
                                      </button>
                                    ) : (
                                      <p className="text-xs text-slate-400 truncate">@{m.user.username}</p>
                                    )
                                  ) : m.user.telegram_username ? (
                                    <p className="text-xs text-slate-400 truncate">@{m.user.telegram_username}</p>
                                  ) : null}
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${m.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{m.role === "admin" ? t("chat.admin") : t("chat.member")}</span>
                              </li>
                            );
                          })}
                        </ul>
                        {pendingMembers.length > 0 && (
                          <>
                            <h3 className="text-sm font-semibold text-slate-800 mt-5 mb-3">Ожидают подтверждения ({pendingMembers.length})</h3>
                            <ul className="space-y-2">
                              {pendingMembers.map((m) => (
                                <li key={m.id} className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center text-sm font-semibold shrink-0">{getAvatarInitials(userDisplayName(m.user))}</div>
                                  <div className="flex-1 min-w-0"><p className="text-sm text-slate-600 truncate">{userDisplayName(m.user)}</p></div>
                                  {chat?.owner?.id === myUserId ? (
                                    <div className="flex gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        disabled={approveRejectLoading !== null}
                                        onClick={() => handleApproveMember(m.id)}
                                        className="text-xs px-2.5 py-1 rounded-lg bg-green-100 text-green-800 hover:bg-green-200 disabled:opacity-50 font-medium"
                                      >
                                        {approveRejectLoading === m.id ? "…" : t("chat.add")}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={approveRejectLoading !== null}
                                        onClick={() => handleRejectMember(m.id)}
                                        className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 font-medium"
                                      >
                                        Отклонить
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Ожидает</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                    {(mediaLinksFilesTab === "media" || (mediaLinksFilesTab === "participants" && !showParticipants)) && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {mediaMessages.slice(-24).reverse().map((msg) => {
                          const url = thumbUrl(msg);
                          const isImg = isImage(msg);
                          return (
                          <button key={msg.id} type="button" onClick={() => scrollToMessageId(msg.id)} className="aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-400">
                            {isImg && url ? (
                              <ProgressiveImage src={toSameOriginMediaUrl(url) || url} alt="" className="w-full h-full" objectFit="cover" fullWidth={400} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                {isVideo(msg) ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                                )}
                              </div>
                            )}
                          </button>
                        ); })}
                        {mediaMessages.length === 0 && <p className="text-xs text-slate-500 col-span-3">Нет фото и видео</p>}
                      </div>
                    )}
                    {mediaLinksFilesTab === "links" && (
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {linkMessages.slice(-20).reverse().map((msg) => {
                          const links = (msg.content || "").match(urlRe) || [];
                          return links.slice(0, 2).map((url, i) => (
                            <li key={`${msg.id}-${i}`}>
                              <button type="button" onClick={() => scrollToMessageId(msg.id)} className="w-full text-left text-sm text-blue-600 hover:underline truncate block px-2 py-1 rounded hover:bg-slate-50">
                                {url}
                              </button>
                            </li>
                          ));
                        })}
                        {linkMessages.length === 0 && <p className="text-xs text-slate-500">{t("chat.noLinks")}</p>}
                      </ul>
                    )}
                    {mediaLinksFilesTab === "voice" && (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {(() => {
                          const voiceItems: VoiceInfoItem[] = [
                            ...voiceMessages.map((m) => ({ kind: "voice" as const, msg: m })),
                            ...circleMessages.map((m) => ({ kind: "circle" as const, msg: m })),
                          ].sort((a, b) => {
                            const ta = Date.parse(a.msg.created_at || "") || 0;
                            const tb = Date.parse(b.msg.created_at || "") || 0;
                            return ta - tb;
                          });

                          const last = voiceItems.slice(-30).reverse();
                          return last.length > 0 ? (
                            <VoiceInfoList
                              items={last}
                              locale={getLocale(lang)}
                              voiceLabel={t("chat.voiceMessage")}
                              circleLabel={t("chat.videoCircle")}
                              onJump={(id) => scrollToMessageId(id)}
                            />
                          ) : (
                            <p className="text-xs text-slate-500">{t("chat.noVoiceMessages")}</p>
                          );
                        })()}
                      </div>
                    )}
                    {mediaLinksFilesTab === "files" && (
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {fileMessages.slice(-20).reverse().map((msg) => {
                          const name = (msg.file && typeof msg.file === "object" && "original_name" in msg.file) ? (msg.file as { original_name?: string }).original_name : msg.content || t("common.file");
                          return (
                            <li key={msg.id}>
                              <button type="button" onClick={() => scrollToMessageId(msg.id)} className="w-full text-left text-sm text-slate-700 hover:bg-slate-50 truncate block px-2 py-1.5 rounded flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span className="truncate">{name}</span>
                              </button>
                            </li>
                          );
                        })}
                        {fileMessages.length === 0 && <p className="text-xs text-slate-500">{t("chat.noFiles")}</p>}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}

          </div>
            </>
            )}
        </aside>
        </>
      )}
      </div>
    </div>
  );
}

/* ================================================================
   MessageBubble
   ================================================================ */


/** Message consists only of emoji (and spaces) — render without bubble, larger. Digits alone don't count as emoji. */
function isOnlyEmoji(str: string): boolean {
  const t = str.trim();
  if (t.length === 0 || t.length > 30) return false;
  if (/^[\d\s]+$/.test(t)) return false;
  return /^[\p{Emoji}\s]+$/u.test(t) && /[\p{Emoji}]/u.test(t);
}

const MESSAGE_TEXT_BASE_REM = 13 / 16;
const MESSAGE_EMOJI_BASE_REM = 28 / 16;

type FileIconType = "document" | "text" | "audio" | "video" | "slides" | "model3d" | "drawing" | "code";

function getFileIconType(mime: string, fileName: string): FileIconType {
  const ext = (fileName || "").toLowerCase().replace(/.*\./, "");
  if (mime.startsWith("audio/") || /^(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/.test(ext)) return "audio";
  if (mime.startsWith("video/") || /^(mp4|webm|mov|avi|mkv|ogv)$/.test(ext)) return "video";
  if (mime.startsWith("model/") || /^(stl|obj|blend|fbx|glb|gltf|3ds|dae|x3d|wrl|ply|off)$/.test(ext)) return "model3d";
  if (/^(dwg|dxf|step|stp|iges|igs|ifc|rvt|skp)$/.test(ext) || /dxf|dwg|acad|step/.test(mime)) return "drawing";
  if (/^(py|pyw|js|jsx|ts|tsx|vue|go|rs|java|kt|kts|c|h|cpp|hpp|cc|cxx|cs|rb|php|sql|r|swift|scala|sbt|gradle|proto)$/.test(ext)
    || mime.startsWith("text/x-") || /javascript|typescript|python|yaml|toml/.test(mime)) return "code";
  if (mime.startsWith("text/") || /^application\/(json|xml|xhtml\+xml)$/.test(mime) || /^(txt|md|json|xml|csv|log|ini|cfg|conf|env|lock|sum|mod)$/.test(ext)) return "text";
  if (/presentation|powerpoint|opendocument\.presentation/.test(mime) || /^(ppt|pptx|key|odp)$/.test(ext)) return "slides";
  return "document";
}

const FileTypeIconBox = memo(function FileTypeIconBox({ type, isMine }: { type: FileIconType; isMine: boolean }) {
  const bg = isMine ? "bg-blue-200/80 text-blue-700" : "bg-slate-200/90 text-slate-600";
  const iconClass = "w-5 h-5 shrink-0";
  const icons: Record<FileIconType, React.ReactNode> = {
    document: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
    ),
    text: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
    ),
    audio: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    ),
    video: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
    ),
    slides: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
    ),
    model3d: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12 4 7.5"/></svg>
    ),
    drawing: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><path d="M12 3v18"/><path d="m8 7 4-4 4 4"/><path d="m8 17 4 4 4-4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5 9l2 2"/><path d="M5 15l2-2"/><path d="M19 9l-2 2"/><path d="M19 15l-2-2"/></svg>
    ),
    code: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    ),
  };
  return (
    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${bg}`} aria-hidden>
      {icons[type]}
    </div>
  );
});

/** File name: if it fits half the screen — show in full without wrapping; otherwise start + "....." + last 5 chars + extension */
function parseSharedContactMessage(content: string): { name: string; href: string; label: string } | null {
  const match = content.trim().match(/^👤\s+(.+?)\s+—\s+(https?:\/\/\S+)$/);
  if (!match) return null;
  try {
    const href = match[2];
    const url = new URL(href);
    const label = url.searchParams.get("write") || url.pathname.replace(/^\/+/, "") || href;
    return { name: match[1].trim(), href, label };
  } catch {
    return null;
  }
}

function TelegramInfoCard({
  leading,
  title,
  subtitle,
  isMine,
  href,
  onClick,
  disabled = false,
  titleNode,
}: {
  leading: React.ReactNode;
  title?: string;
  subtitle?: string;
  isMine: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  titleNode?: React.ReactNode;
}) {
  const className = `chat-entity-card ${isMine ? "chat-entity-card--mine" : "chat-entity-card--other"} ${disabled ? "opacity-75" : "cursor-pointer hover:-translate-y-px"} transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out`;
  const content = (
    <>
      <div className="shrink-0">{leading}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">
          {titleNode ?? title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-[0.6875rem] text-slate-500">
            {subtitle}
          </div>
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`flex min-w-[220px] max-w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left ${className}`}>
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={`flex min-w-[220px] max-w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left ${className}`}>
        {content}
      </button>
    );
  }

  return (
    <div className={`flex min-w-[220px] max-w-full items-center gap-3 rounded-[20px] px-3 py-2.5 ${className}`}>
      {content}
    </div>
  );
}

function FileNameDisplay({ fileName, className = "" }: { fileName: string; className?: string }) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<{ text: string; full: boolean }>({ text: fileName, full: true });

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const halfScreen = window.innerWidth / 2;
    const fullWidth = el.getBoundingClientRect().width;
    if (fullWidth <= halfScreen) {
      setDisplay({ text: fileName, full: true });
      return;
    }
    const lastDot = fileName.lastIndexOf(".");
    const ext = lastDot > 0 && fileName.length - lastDot <= 6 ? fileName.slice(lastDot) : "";
    const base = ext ? fileName.slice(0, lastDot) : fileName;
    const baseEnd = base.slice(-5);
    const dots = ".....";
    const approxCharPx = fullWidth / fileName.length;
    const targetChars = Math.floor(halfScreen / approxCharPx);
    const startLen = Math.max(0, Math.min(base.length - 5, targetChars - dots.length - 5 - ext.length));
    const baseStart = base.slice(0, startLen);
    const text = baseStart + dots + baseEnd + ext;
    setDisplay({ text, full: false });
  }, [fileName]);

  return (
    <span className="relative inline-block min-w-0 overflow-hidden">
      <span ref={measureRef} aria-hidden className="absolute text-sm whitespace-nowrap" style={{ left: -9999, visibility: "hidden" }}>
        {fileName}
      </span>
      <span className={`text-sm whitespace-nowrap overflow-hidden text-ellipsis block ${className}`} title={display.full ? undefined : fileName}>
        {display.text}
      </span>
    </span>
  );
}

/** Date divider between messages (Today, Yesterday, February 15) */
function DateDivider({ date, lang }: { date: string; lang: "en" | "ru" }) {
  const label = formatDateLabel(date, lang);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex-1 h-px bg-slate-300" aria-hidden />
      <span className="text-xs font-medium text-slate-500 shrink-0">{label}</span>
      <span className="flex-1 h-px bg-slate-300" aria-hidden />
    </div>
  );
}

function ForwardModal({ messages, sourceChatId, onClose, onForwardComplete }: { messages: Message[]; sourceChatId: string; onClose: () => void; onForwardComplete?: (targetChatIds: string[]) => void }) {
  const { t } = useTranslation();
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    chatsApi.list().then((res) => {
      const items = Array.isArray(res.data) ? res.data : (res.data as { results?: Chat[] }).results ?? [];
      setChats(items);
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filtered = chats.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return c.title.toLowerCase().includes(q) || (c.other_member ? userDisplayName(c.other_member) : "").toLowerCase().includes(q);
  });

  const toggleChat = (id: string) => {
    if (id === sourceChatId) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    const ids = Array.from(selectedIds).filter((id) => id !== sourceChatId);
    if (ids.length === 0) return;
    if (sending) return;
    setSending(true);
    try {
      const storeUpsertMessage = useMessagesStore.getState().upsertMessage;
      for (const targetChatId of ids) {
        for (const message of messages) {
          const res = await messagesApi.forward(targetChatId, { message_id: message.id, source_chat_id: sourceChatId });
          const msg = storeNormalizeMessage({ ...res.data, chat: targetChatId } as Message & { chat: string });
          storeUpsertMessage(targetChatId, msg);
          broadcastMessageCreated(targetChatId, msg);
        }
      }
      setSent(true);
      onForwardComplete?.(ids);
      setTimeout(() => onClose(), 800);
    } catch {
      setSending(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-[90vw] max-w-md max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">{messages.length > 1 ? `${t("chat.forward")} (${messages.length})` : t("chat.forwardMessage")}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {sent ? (
          <div className="flex items-center justify-center p-8 text-green-600 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M20 6 9 17l-5-5"/></svg>
            {t("chat.forwarded")}
          </div>
        ) : (
          <>
            <div className="px-4 pt-3 pb-2">
              <input
                type="text"
                placeholder={t("chat.searchChat")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
              {filtered.map((c) => {
                const chatTitle = c.is_favorites ? t("chat.favoritesTitle") : c.is_personal && c.other_member ? userDisplayName(c.other_member) : c.title;
                const isSelected = selectedIds.has(c.id);
                const isSource = c.id === sourceChatId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors ${isSelected ? "bg-blue-50" : ""} ${isSource ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() => !isSource && toggleChat(c.id)}
                    disabled={sending}
                  >
                    {c.is_favorites ? (
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      </div>
                    ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
                      {getAvatarInitials(chatTitle)}
                    </div>
                    )}
                    <span className="flex-1 text-sm text-slate-800 truncate flex items-center gap-1">
                      {chatTitle}
                      {c.title_icon && <span className="shrink-0" aria-hidden>{c.title_icon}</span>}
                    </span>
                    {isSelected && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-6">{t("messenger.noMatchingChats")}</div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={sending || selectedIds.size === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-500 text-white font-medium text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                {sending ? t("chat.forwardSending") : `${t("chat.forward")} (${selectedIds.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PollMessageContent({
  message,
  chatId,
  onMessageUpdated,
  timeEl,
  hasReactions,
  reactionButtons,
}: {
  message: Message;
  chatId: string;
  onMessageUpdated: (msg: Message) => void;
  timeEl: React.ReactNode;
  hasReactions: boolean;
  reactionButtons: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [voting, setVoting] = useState(false);
  /** When true, show results even if user hasn't voted (e.g. in anonymous poll) */
  const [showResultsOverride, setShowResultsOverride] = useState(false);
  /** For anonymous polls: backend returns my_vote=null, so track locally that user voted and which indices */
  const [anonymousVotedIndices, setAnonymousVotedIndices] = useState<number[] | null>(null);
  const pollData = message.poll_data!;
  const options = pollData.options ?? [];
  const multiple = pollData.multiple ?? false;
  const anonymous = pollData.anonymous ?? false;
  const quiz = pollData.quiz ?? false;
  const correctIndex = typeof pollData.correct_index === "number" ? pollData.correct_index : null;
  const results = message.poll_results ?? options.map(() => ({ count: 0 }));
  const myVote = message.my_vote ?? null;
  const hasVotedFromServer = myVote != null && myVote.length > 0;
  const effectiveVote = anonymous ? anonymousVotedIndices : myVote;
  const hasVoted = (effectiveVote != null && effectiveVote.length > 0) || hasVotedFromServer;
  const totalVotes = results.reduce((s, r) => s + (r?.count ?? 0), 0);
  /** Show counts/bars: after vote, or non-anonymous, or user chose "view results" */
  const resultsVisible = (hasVoted || !anonymous) || showResultsOverride;

  const handleVote = async (indices: number[]) => {
    if (voting) return;
    setVoting(true);
    try {
      const res = await messagesApi.pollVote(chatId, message.id, indices);
      onMessageUpdated(storeNormalizeMessage(res.data));
      if (anonymous) setAnonymousVotedIndices(indices.length > 0 ? indices : null);
    } finally {
      setVoting(false);
    }
  };

  const handleUnvote = async () => {
    if (voting) return;
    setVoting(true);
    try {
      const res = await messagesApi.pollUnvote(chatId, message.id);
      onMessageUpdated(storeNormalizeMessage(res.data));
      if (anonymous) setAnonymousVotedIndices(null);
    } catch {
      // Try POST with empty array as fallback
      try {
        const res = await messagesApi.pollVote(chatId, message.id, []);
        onMessageUpdated(storeNormalizeMessage(res.data));
        if (anonymous) setAnonymousVotedIndices(null);
      } finally {}
    } finally {
      setVoting(false);
    }
  };

  const toggleOption = (idx: number) => {
    if (multiple) {
      const current = effectiveVote ?? [];
      const next = [...current];
      const i = next.indexOf(idx);
      if (i >= 0) next.splice(i, 1);
      else next.push(idx);
      next.sort((a, b) => a - b);
      handleVote(next);
    } else {
      handleVote([idx]);
    }
  };

  return (
    <div className="min-w-0 max-w-full">
      {message.content && (
        <p className="text-sm font-medium text-slate-800 mb-2">{message.content}</p>
      )}
      <div className="space-y-1.5">
        {options.map((opt, idx) => {
          const count = results[idx]?.count ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = effectiveVote?.includes(idx) ?? false;
          const isCorrect = quiz && correctIndex === idx;
          const showCorrect = quiz && hasVoted && isCorrect;
          return (
            <button
              key={idx}
              type="button"
              disabled={voting}
              onClick={() => (quiz ? (hasVoted ? undefined : toggleOption(idx)) : (isSelected && hasVoted && !multiple ? handleUnvote() : toggleOption(idx)))}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                showCorrect ? "bg-emerald-50 border-emerald-400" : isSelected ? "bg-blue-100 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-800 truncate flex-1">{opt || `Option ${idx + 1}`}</span>
                {showCorrect && (
                  <span className="shrink-0 text-emerald-600" title={t("chat.pollCorrectAnswer")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                )}
                {resultsVisible && !showCorrect && (
                  <span className="text-xs text-slate-500 shrink-0 tabular-nums">{pct}%{!anonymous ? ` (${count})` : ""}</span>
                )}
              </div>
              {resultsVisible && totalVotes > 0 && (
                <div className="mt-1.5 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {!quiz && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          {hasVoted && (
            <button type="button" onClick={handleUnvote} disabled={voting} className="hover:text-slate-700">
              {t("chat.pollUnvote")}
            </button>
          )}
          {hasVoted && <span className="text-slate-400" aria-hidden>|</span>}
          {!resultsVisible && (
            <button type="button" onClick={() => setShowResultsOverride(true)} className="hover:text-slate-700">
              {t("chat.pollViewResults")}
            </button>
          )}
          {showResultsOverride && !hasVoted && (
            <button type="button" onClick={() => setShowResultsOverride(false)} className="hover:text-slate-700">
              {t("chat.pollHideResults")}
            </button>
          )}
          {resultsVisible && !showResultsOverride && (hasVoted || !anonymous) && (
            <span className="text-slate-500">{t("chat.pollViewResults")}</span>
          )}
        </div>
      )}
      <div className={`mt-1 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
        {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
      </div>
    </div>
  );
}

type MessageBubbleProps = {
  message: Message;
  isMine: boolean;
  chatId: string;
  /** When set, use channel posts API for update/delete (channel mode) */
  channelId?: string;
  /** Show avatar (false — placeholder for message grouping) */
  showAvatar?: boolean;
  /** Last message in a group (tail pointing toward the avatar) */
  isLastInGroup?: boolean;
  /** First message in a group — show sender name above (group chats only) */
  showSenderName?: boolean;
  onMessageUpdated: (msg: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  /** Update message/post content (chat: messagesApi, channel: channelPostsApi) */
  onUpdateMessageContent?: (messageId: string, content: string) => Promise<Message>;
  /** Delete message/post */
  onDeleteMessage?: (messageId: string) => Promise<void>;
  /** Called when delete request fails (e.g. 403). */
  onDeleteError?: (error: unknown) => void;
  /** For emoji-only messages — edit in the input field instead of inline */
  onStartEditInInput?: (messageId: string, content: string) => void;
  /** Click on a single image — open in modal instead of a new tab */
  /** Whether the current user can pin a message for everyone (admin/owner) */
  canPinForAll?: boolean;
  /** IDs of messages pinned for everyone in the chat */
  pinnedForAllIds?: string[];
  /** Maximum allowed number of messages pinned for everyone */
  maxPins?: number;
  /** Click on sender avatar (open user info) */
  onAvatarClick?: (userId?: string) => void;
  /** IDs of messages pinned by the current user for themselves */
  myPinnedIds?: string[];
  /** Callback after pin/unpin (refresh chat) */
  onPinChange?: () => void;
  /** Reply to a message */
  onReply?: (message: Message) => void;
  /** Forward a message */
  onForward?: (message: Message) => void;
  /** Multiselect mode */
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (messageId: string) => void;
  onEnterSelectionMode?: (messageId: string) => void;
  /** When set (channel mode), use channel API for reactions instead of messagesApi */
  onSetReaction?: (messageId: string, emoji: string) => Promise<Message>;
  commentsCount?: number;
  onOpenComments?: () => void;
  /** Обновить только реакции в сторе (без замены всего сообщения — фото не перезагружаются). */
  onReactionUpdated?: (messageId: string, data: { reactions: Record<string, number>; my_reactions: string[] }) => void;
  /** Пикер реакций открыт только у одного сообщения; управляется родителем */
  reactionPickerOpen?: boolean;
  onOpenReactionPicker?: () => void;
  onCloseReactionPicker?: () => void;
  /** Upload progress for temp messages (X/Y MB). */
  uploadProgress?: { loaded: number; total: number };
  /** Cancel in-flight upload (removes optimistic message and aborts request). */
  onCancelUpload?: (messageId: string) => void;
  /** Download progress when recipient fetches file (X/Y MB). */
  downloadProgress?: { loaded: number; total: number };
  /** When set, file link triggers this (fetch with progress) instead of opening href. */
  onDownloadWithProgress?: (messageId: string, url: string, filename: string) => void;
};

/** Delay before hiding reaction picker when mouse leaves message/picker (lets user move to picker) */
const REACTION_PICKER_HIDE_DELAY_MS = 1800;

const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  chatId,
  showAvatar = true,
  isLastInGroup = false,
  showSenderName = false,
  onMessageUpdated,
  onMessageDeleted,
  onUpdateMessageContent,
  onDeleteMessage,
  onDeleteError,
  onStartEditInInput,
  canPinForAll,
  pinnedForAllIds,
  maxPins,
  myPinnedIds,
  onPinChange,
  onReply,
  onForward,
  onAvatarClick,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onEnterSelectionMode,
  onSetReaction,
  commentsCount,
  onOpenComments,
  onReactionUpdated,
  reactionPickerOpen = false,
  onOpenReactionPicker,
  onCloseReactionPicker,
  uploadProgress,
  onCancelUpload,
  downloadProgress,
  onDownloadWithProgress,
}: MessageBubbleProps) {
  const { t, lang } = useTranslation();
  const [_hoverDelayPassed, setHoverDelayPassed] = useState(false);
  const hoverDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [_pickerHover, setPickerHover] = useState(false);
  const pickerVisible = reactionPickerOpen;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || "");
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [reactionLoading, setReactionLoading] = useState(false);
  const [reactionLimitToast, setReactionLimitToast] = useState(false);
  const reactionLimitToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuCopied, setContextMenuCopied] = useState(false);
  const [contextMenuCopyShake, setContextMenuCopyShake] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeActiveRef = useRef(false);
  const swipeXRef = useRef(0);
  const [swipeBounce, setSwipeBounce] = useState(false);
  const swipeBounceFromRef = useRef(0);
  const messageWrapperRef = useRef<HTMLDivElement>(null);
  const swipeWrapperRef = useRef<HTMLDivElement>(null);
  const swipeReplyIconRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (reactionLimitToastTimerRef.current) clearTimeout(reactionLimitToastTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
    if (pickerHideTimerRef.current) clearTimeout(pickerHideTimerRef.current);
  }, []);

  /** Когда родитель закрыл пикер у этого сообщения — сбрасываем локальное состояние и отменяем таймер скрытия (чтобы не закрыть пикер другого сообщения). */
  useEffect(() => {
    if (!reactionPickerOpen) {
      if (hoverDelayTimerRef.current) {
        clearTimeout(hoverDelayTimerRef.current);
        hoverDelayTimerRef.current = null;
      }
      if (pickerHideTimerRef.current) {
        clearTimeout(pickerHideTimerRef.current);
        pickerHideTimerRef.current = null;
      }
      setHoverDelayPassed(false);
      setPickerHover(false);
    }
  }, [reactionPickerOpen]);

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  const applySwipeVisuals = (x: number) => {
    const wrapper = swipeWrapperRef.current;
    const icon = swipeReplyIconRef.current;
    if (wrapper) {
      if (x > 0) {
        wrapper.style.transform = `translateX(${x}px)`;
        wrapper.style.transition = "none";
      } else {
        wrapper.style.transition = "transform 0.25s ease-out";
        wrapper.style.transform = "translateX(0px)";
      }
    }
    if (icon) {
      if (x > 0) {
        icon.style.display = "";
        icon.style.opacity = String(Math.min(x / 60, 1));
        const svg = icon.querySelector("svg");
        if (svg instanceof HTMLElement) {
          svg.style.color = x >= 60 ? "#3b82f6" : "#94a3b8";
          svg.style.transform = x >= 60 ? "scale(1.1)" : "";
        }
      } else {
        icon.style.display = "none";
        icon.style.opacity = "0";
      }
    }
  };

  const handleLongPress = () => {
    longPressTimerRef.current = null;
    if (!longPressStartRef.current) return;
    setContextMenu({ x: longPressStartRef.current.x, y: longPressStartRef.current.y });
    longPressStartRef.current = null;
    if (navigator.vibrate) navigator.vibrate(15);
  };
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  // Call hook unconditionally (before any early return) to satisfy Rules of Hooks
  const rawFileUrl = message.file ? ((message.file as { url?: string }).url || "#") : "#";
  const fileUrlFromCache = useCachedMediaUrl(rawFileUrl !== "#" ? rawFileUrl : null);
  const fileUrl = fileUrlFromCache || rawFileUrl;

  // All hooks must run before early return (Rules of Hooks) — same count when message becomes is_deleted
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  useEffect(() => {
    const el = messageWrapperRef.current;
    if (!el || !onReply) return;
    const WHEEL_THRESHOLD = 80;
    const handleWheel = (e: WheelEvent) => {
      // Prevent accidental reply triggers on desktop (e.g., trackpad quirks / double-click gestures).
      // Require an explicit "horizontal scroll" intent via Shift.
      if (!e.shiftKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (e.deltaX < WHEEL_THRESHOLD) return;
      e.preventDefault();
      onReply(message);
      if (navigator.vibrate) navigator.vibrate(15);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [message, onReply]);

  const schedulePickerHide = useCallback(() => {
    if (pickerHideTimerRef.current) clearTimeout(pickerHideTimerRef.current);
    pickerHideTimerRef.current = setTimeout(() => {
      pickerHideTimerRef.current = null;
      onCloseReactionPicker?.();
      setHoverDelayPassed(false);
      setPickerHover(false);
    }, REACTION_PICKER_HIDE_DELAY_MS);
  }, [message.id, isMine, onCloseReactionPicker]);

  const handleRowMouseLeave = useCallback(() => {
    if (reactionPickerOpen) onCloseReactionPicker?.();
  }, [reactionPickerOpen, onCloseReactionPicker]);

  // Deleted message placeholder
  if (message.is_deleted) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-slate-400 italic">{t("chat.messageDeleted")}</span>
      </div>
    );
  }

  const isFile = message.msg_type !== "text" && message.msg_type !== "emoji" && message.msg_type !== "gif" && message.msg_type !== "sticker" && message.msg_type !== "poll";
  const isGif = message.msg_type === "gif" && message.content;
  const isSticker = message.msg_type === "sticker" && (message.content || message.file);
  const isPoll = message.msg_type === "poll" && message.poll_data;
  const senderName = getSenderName(message);
  const content = message.content || t("common.fileMsg");
  const sharedContact = !isFile ? parseSharedContactMessage(content) : null;
  const isSharedContact = !!sharedContact;
  const isShortText = !isFile && !isSharedContact && !content.includes("\n") && content.length <= 40;
  const isEmojiOnly = !isFile && !content.includes("\n") && isOnlyEmoji(content);
  const reactions = message.reactions ?? {};
  const myReactions: string[] = message.my_reactions ?? [];
  const canEdit = isMine && !isFile && message.msg_type === "text";
  const canAddReaction = myReactions.length < 3;

  const fileName = message.file ? (message.file as { original_name?: string }).original_name || message.content : message.content;
  const fileMime = (message.file && (message.file as { mime_type?: string }).mime_type) || "";
  const isImageByMime = fileMime.startsWith("image/");
  const isVideoByMime = fileMime.startsWith("video/");
  const ext = (fileName || "").toLowerCase().replace(/.*\./, "");
  const isImageByExt = /^(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/.test(ext);
  const isVideoByExt = /^(mp4|webm|mov|avi|mkv|ogv)$/.test(ext);
  const fileIsImage = isImageByMime || (message.file && !fileMime && isImageByExt);
  const fileIsVideo = isVideoByMime || (message.file && !fileMime && isVideoByExt);
  // Show as link only for non-media; images and videos always have preview
  const isImage = message.file && fileIsImage;
  // fileUrl is used directly for all media types
  const isAudio = message.msg_type === "audio" || (message.file && (message.file as { mime_type?: string }).mime_type?.startsWith("audio/"));
  const isVideo = message.file && !isAudio && (message.msg_type === "video" || fileIsVideo);
  const isVideoCircle = message.msg_type === "video_circle" && !isAudio && (message.file || uploadProgress);

  // Multiple images — tile layout; check both mime and extension
  const allFiles = (message.files ?? []).filter((f) => f != null && typeof f === "object" && "id" in f) as Message["files"];
  const imageFiles = allFiles.filter((f) => (f.mime_type || "").startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(f.original_name || ""));
  const isImageGroup = isFile && imageFiles.length >= 1 && imageFiles.length === allFiles.length;
  const imageFilesKey = imageFiles.map((f) => `${f.id}:${f.url ?? ""}:${f.original_name ?? ""}:${f.mime_type ?? ""}`).join("|");
  // Media bubbles (no background/padding like text bubbles)
  const isImageBubble = isVideoCircle || isVideo || isImageGroup || (isFile && isImage);

  const optimalBubbleWidth: number | null = null;

  const locale = getLocale(lang);
  const timeStr = new Date(message.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const editedStr = message.edited_at
    ? new Date(message.edited_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : null;
  const viewsCount = typeof message.views_count === "number" ? message.views_count : null;
  const isPendingOutbox = isMine && message.sender?.id === "self";
  const readStatus = isMine ? (isPendingOutbox ? "pending" : (message.read_status || "delivered")) : null;
  const Checkmarks = readStatus === "pending" ? (
    <span className="ml-1 inline-flex" title={t("chat.sending")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse opacity-80"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </span>
  ) : readStatus === "read" ? (
    <span className="ml-1 inline-flex" title={t("chat.read")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="-ml-1"><path d="M20 6 9 17l-5-5"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="-ml-2.5"><path d="M20 6 9 17l-5-5"/></svg>
    </span>
  ) : readStatus === "delivered" ? (
    <span className="ml-1 inline-flex" title={t("chat.delivered")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </span>
  ) : null;

  const handleReaction = async (emoji: string) => {
    if (!myReactions.includes(emoji) && !canAddReaction) {
      setReactionLimitToast(true);
      if (reactionLimitToastTimerRef.current) clearTimeout(reactionLimitToastTimerRef.current);
      reactionLimitToastTimerRef.current = setTimeout(() => setReactionLimitToast(false), 3000);
      return;
    }
    setReactionLoading(true);
    try {
      const msg = onSetReaction
        ? await onSetReaction(message.id, emoji)
        : (await messagesApi.setReaction(chatId, message.id, emoji)).data;
      const normalized = storeNormalizeMessage(msg);
      if (onReactionUpdated) {
        onReactionUpdated(message.id, { reactions: normalized.reactions ?? {}, my_reactions: normalized.my_reactions ?? [] });
      } else {
        onMessageUpdated(normalized);
      }
    } finally {
      setReactionLoading(false);
    }
  };

  const handleSaveEdit = () => {
    const text = editText.trim().slice(0, MESSAGE_MAX_LENGTH);
    if (text === (message.content || "").slice(0, MESSAGE_MAX_LENGTH)) {
      setEditing(false);
      return;
    }
    if (!text) return;
    const doUpdate = onUpdateMessageContent
      ? onUpdateMessageContent(message.id, text)
      : messagesApi.update(chatId, message.id, { content: text }).then((res) => res.data);
    doUpdate.then((msg) => {
      onMessageUpdated(normalizeMessage(msg));
      setEditing(false);
      setEditText(msg.content || "");
    });
  };

  const handleCancelEdit = () => {
    setEditText(message.content || "");
    setEditing(false);
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleDelete = () => {
    closeContextMenu();
    const doDelete = onDeleteMessage
      ? onDeleteMessage(message.id)
      : messagesApi.delete(chatId, message.id);
    doDelete
      .then(() => onMessageDeleted?.(message.id))
      .catch((err) => onDeleteError?.(err));
  };

  const hasReactions = Object.keys(reactions).length > 0;
  const reactionEntries = Object.entries(reactions).filter(([, c]) => c > 0);
  const hasCommentsFooter = typeof commentsCount === "number" && commentsCount >= 0 && !!onOpenComments;
  const fileCardSubtitle = uploadProgress || downloadProgress
    ? `${(uploadProgress ? (uploadProgress.loaded / 1024 / 1024).toFixed(1) : (downloadProgress!.loaded / 1024 / 1024).toFixed(1))} / ${(uploadProgress ? (uploadProgress.total / 1024 / 1024).toFixed(1) : (downloadProgress!.total / 1024 / 1024).toFixed(1))} ${t("chat.progressMB")}`
    : (isAudio ? t("common.voice") : t("common.fileMsg"));
  const bubbleSurfaceClass = isMine ? "chat-bubble-surface chat-bubble-surface--mine" : "chat-bubble-surface chat-bubble-surface--other";
  const commentsFooterSurfaceClass = isMine ? "chat-bubble-footer chat-bubble-footer--mine" : "chat-bubble-footer chat-bubble-footer--other";
  const commentsFooterLayoutClass = isImageBubble || isSticker
    ? "mt-0 w-full"
    : "-mx-3 -mb-1.5 mt-2 w-[calc(100%+1.5rem)]";

  const reactionCount = reactionEntries.length;
  const allowReactionWrap = reactionCount >= 5;
  const reactionButtons = hasReactions ? (
    <span className={`inline-flex items-center gap-x-1 gap-y-0.5 ${allowReactionWrap ? "flex-wrap" : "flex-nowrap"}`}>
      {reactionEntries.map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleReaction(emoji)}
          className={`reaction-chip inline-flex items-center rounded px-1 py-0.5 text-xs cursor-pointer shrink-0 ${
            myReactions.includes(emoji)
              ? "bg-blue-100/80 border border-blue-300/60 text-blue-800"
              : "border border-slate-200/80 text-slate-600 hover:bg-slate-50"
          }`}
          disabled={reactionLoading}
          title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : t("chat.maxReactions")}
        >
          <AnimatedReaction emoji={emoji} size={18} playOnce preferEmoji={emoji !== "🔥"} />
          {count > 1 && <span className="ml-0.5 tabular-nums">{count}</span>}
        </button>
      ))}
    </span>
  ) : null;

  /** Whether the message contains @-mentions (for the @ icon like in Telegram) */
  const hasMentionInContent = (message.msg_type === "text" || message.msg_type === "emoji") && splitContentWithMentions(message.content || "").some((s) => s.type === "mention");

  /** Time (+ edited) + checkmarks + @ for mentions — sequentially in one line */
  const timeEl = (
    <span className={`inline-flex flex-nowrap items-center gap-x-1 text-[0.625rem] min-w-0 shrink-0 whitespace-nowrap ${isMine ? "text-slate-500" : "text-slate-400"}`}>
      {hasMentionInContent && <span className="font-medium text-slate-500" title={t("chat.mentionLabel")}>@</span>}
      {viewsCount !== null && (
        <span className="inline-flex items-center gap-0.5 tabular-nums" title="Views">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{viewsCount}</span>
        </span>
      )}
      {timeStr}
      {editedStr && <span className="opacity-80 ml-0.5">ред. {editedStr}</span>}
      {Checkmarks}
    </span>
  );

  const handleMouseEnter = () => {
    if (pickerHideTimerRef.current) {
      clearTimeout(pickerHideTimerRef.current);
      pickerHideTimerRef.current = null;
    }
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
    hoverDelayTimerRef.current = setTimeout(() => {
      setHoverDelayPassed(true);
      onOpenReactionPicker?.();
    }, 400);
  };
  const handleMouseLeave = () => {
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
      hoverDelayTimerRef.current = null;
    }
    schedulePickerHide();
  };

  const messageAlignment = usePreferencesStore((s) => s.messageAlignment);
  const alignRight = isMine && messageAlignment === "right";
  const rowJustify = alignRight ? "justify-end" : "justify-start";
  const contentOrderReverse = alignRight;

  return (
    <div
      ref={messageWrapperRef}
      className={`relative flex w-full ${rowJustify} ${selectionMode ? "cursor-pointer" : ""}`}
      onMouseLeave={handleRowMouseLeave}
      onClick={selectionMode && onToggleSelect ? () => onToggleSelect(message.id) : undefined}
      onContextMenu={(e) => {
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        if (hasSelection && window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        e.preventDefault();
        e.stopPropagation();
        const menuWidth = 200;
        const menuHeight = 180;
        const pad = 8;
        const x = Math.max(pad, Math.min(e.clientX, window.innerWidth - menuWidth - pad));
        const y = Math.max(pad, Math.min(e.clientY, window.innerHeight - menuHeight - pad));
        setContextMenu({ x, y });
      }}
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        longPressStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        swipeActiveRef.current = false;
        swipeXRef.current = 0;
        longPressTimerRef.current = setTimeout(handleLongPress, 500);
      }}
      onTouchMove={(e) => {
        if (!longPressStartRef.current || e.touches.length !== 1) return;
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - longPressStartRef.current.x;
        const dy = y - longPressStartRef.current.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx > 10 || ady > 10) {
          cancelLongPress();
          if (adx > ady * 1.5 && dx > 0 && onReply) {
            swipeActiveRef.current = true;
            const val = Math.min(dx, 80);
            swipeXRef.current = val;
            applySwipeVisuals(val);
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }}
      onTouchEnd={(e) => {
        if (swipeActiveRef.current) {
          const triggered = swipeXRef.current >= 60 && !!onReply;
          swipeActiveRef.current = false;
          if (triggered) {
            onReply!(message);
            if (navigator.vibrate) navigator.vibrate(15);
            swipeBounceFromRef.current = swipeXRef.current;
            const wrapper = swipeWrapperRef.current;
            if (wrapper) {
              wrapper.style.transform = "";
              wrapper.style.transition = "";
            }
            applySwipeVisuals(0);
            setSwipeBounce(true);
          } else {
            applySwipeVisuals(0);
          }
          swipeXRef.current = 0;
          e.stopPropagation();
        } else {
          cancelLongPress();
        }
      }}
      onTouchCancel={(e) => {
        swipeActiveRef.current = false;
        swipeXRef.current = 0;
        applySwipeVisuals(0);
        cancelLongPress();
        e.stopPropagation();
      }}
    >
      {/* Wrapper: [reply icon on swipe] [avatar + bubble + reactions]. Structure: bubble (Telegram-like). */}
      <div
        ref={swipeWrapperRef}
        className={`bubble relative flex flex-row flex-nowrap items-end gap-2 swipe-message w-full ${rowJustify} ${swipeBounce ? "swipe-bounce" : ""}`}
        style={swipeBounce ? { "--swipe-from": `${swipeBounceFromRef.current}px` } as React.CSSProperties : undefined}
        onAnimationEnd={() => setSwipeBounce(false)}
      >
        {selectionMode && (
          <div
            className="flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(message.id); }}
          >
            {isSelected ? (
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
            )}
          </div>
        )}
        {onReply && !selectionMode && (
          <div
            ref={swipeReplyIconRef}
            className="flex items-center justify-center shrink-0 w-10"
            style={{ display: "none", opacity: 0 }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-slate-400 transition-transform"
            >
              <polyline points="9 17 4 12 9 7"/>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
            </svg>
          </div>
        )}
      <div className={`relative inline-flex items-end gap-1.5 min-w-0 max-w-[88%] shrink-0 ${contentOrderReverse ? "flex-row-reverse" : ""}`}>
        {(showAvatar ? (
          (() => {
            const sender = message.sender as User;
            const avatarUrl = sender?.avatar_url ?? sender?.avatar ?? null;
            const isAvatarLink = !(message as Message & { sender_display_name?: string }).sender_display_name && !!sender?.id;
            return (
              isAvatarLink ? (
                <Link
                  to={buildUserInfoHref(sender)}
                  className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden bg-slate-200 transition-shadow cursor-pointer hover:ring-2 hover:ring-blue-300"
                  title={senderName}
                >
                  {avatarUrl ? (
                    <MediaImage
                      source={getAvatarUrlBySize(avatarUrl, (message.sender as User)?.avatar_url_small, (message.sender as User)?.avatar_url_medium, "small")}
                      alt=""
                      className="w-full h-full object-cover"
                      lazy={false}
                    />
                  ) : (
                    <span className="text-xs font-semibold text-slate-600">
                      {getAvatarInitials(senderName)}
                    </span>
                  )}
                </Link>
              ) : (
                <span
                  className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden bg-slate-200"
                  title={senderName}
                >
                  <span className="text-xs font-semibold text-slate-600">
                    {getAvatarInitials(senderName)}
                  </span>
                </span>
              )
            );
          })()
        ) : (
          <div className="w-8 h-8 shrink-0" aria-hidden />
        ))}
        <div
          className="relative flex flex-col min-w-0 group overflow-visible items-start"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
        {isEmojiOnly && !editing ? (
          <div className="inline-flex flex-col gap-0.5 max-w-full min-w-0" style={{ fontSize: `${MESSAGE_EMOJI_BASE_REM}rem` }}>
            {showSenderName ? (
              <div className="mb-0.5 w-full min-w-0">
                <button
                  type="button"
                  onClick={() => !(message as Message & { sender_display_name?: string }).sender_display_name && onAvatarClick?.((message.sender as User)?.id)}
                  className={`font-medium truncate max-w-full text-left block ${(message as Message & { sender_display_name?: string }).sender_display_name ? "cursor-default" : ""} ${isMine ? "text-blue-600 hover:text-blue-700" : "text-emerald-600 hover:text-emerald-700"}`}
                >
                  {senderName}
                </button>
              </div>
            ) : null}
            <div className="inline-flex items-center gap-2 flex-wrap">
              <span className="leading-none">{content.trim()}</span>
              {timeEl}
            </div>
            {hasReactions && (
              <div className={`flex flex-wrap gap-x-1 gap-y-0.5 mt-px animate-reactions-appear justify-start`}>
                {reactionButtons}
              </div>
            )}
          </div>
        ) : (
        <div className={`${hasCommentsFooter ? "w-full min-w-0" : "inline-block max-w-full"} ${isLastInGroup ? "relative overflow-visible" : ""}`} style={optimalBubbleWidth != null && !hasCommentsFooter ? { maxWidth: optimalBubbleWidth } : undefined}>
        <div className={`${hasCommentsFooter ? "w-full min-w-0" : "inline-block max-w-full"} ${message.edited_at && !hasCommentsFooter ? "min-w-fit" : "min-w-0"} ${isImageBubble || isSticker ? `rounded-2xl p-0 ${hasCommentsFooter ? `overflow-hidden ${bubbleSurfaceClass}` : "overflow-visible"}` : isShortText ? "overflow-visible" : "overflow-hidden"} ${isImageBubble || isSticker ? "rounded-2xl p-0" : `rounded-xl px-3 py-2 text-slate-800 ${bubbleSurfaceClass}`}`} style={{ fontSize: `${MESSAGE_TEXT_BASE_REM}rem` }}>
          {/* Имя отправителя — внутри пузырька, тот же размер что и текст сообщения */}
          {showSenderName ? (
            <div className={`mb-0.5 w-full min-w-0 ${isImageBubble || isSticker ? "px-3 pt-2 pb-1" : ""}`}>
              <button
                type="button"
                onClick={() => !(message as Message & { sender_display_name?: string }).sender_display_name && onAvatarClick?.((message.sender as User)?.id)}
                className={`font-medium truncate max-w-full text-left block ${(message as Message & { sender_display_name?: string }).sender_display_name ? "cursor-default" : ""} ${isMine ? "text-blue-600 hover:text-blue-700" : "text-emerald-600 hover:text-emerald-700"}`}
              >
                {senderName}
              </button>
            </div>
          ) : null}
          {/* Forwarded header */}
          {message.forwarded_from && (
            <div className="flex items-center gap-1 text-xs text-slate-500 italic mb-0.5 -mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              <span>Переслано от <strong className="not-italic font-medium text-slate-600">{userDisplayName(message.forwarded_from as User)}</strong></span>
              {message.forwarded_from_chat_title && (
                <span className="text-slate-400 ml-0.5">из «{message.forwarded_from_chat_title}»</span>
              )}
            </div>
          )}
          {/* Reply quote block — aligned to the right for own messages */}
          {message.reply_to && !message.reply_to.is_deleted && (
            <div className="mb-0.5 -mt-0.5 max-w-full min-w-0">
              <button
                type="button"
                className={`block w-full max-w-full min-w-0 rounded-lg border-l-[3px] px-2 py-0.5 text-left ${isMine ? "border-blue-400 bg-blue-50/50" : "border-slate-400 bg-slate-50/50"} cursor-pointer hover:opacity-80`}
                onClick={() => {
                  const el = document.querySelector(`[data-message-id="${message.reply_to!.id}"]`);
                  el?.previousElementSibling?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                  if (el) {
                    setTimeout(() => {
                      const msgEl = el.previousElementSibling as HTMLElement | null;
                      if (!msgEl) return;
                      msgEl.classList.remove("msg-highlight-flash");
                      void msgEl.offsetWidth;
                      msgEl.classList.add("msg-highlight-flash");
                      const onEnd = () => { msgEl.classList.remove("msg-highlight-flash"); msgEl.removeEventListener("animationend", onEnd); };
                      msgEl.addEventListener("animationend", onEnd);
                    }, 350);
                  }
                }}
              >
                <div className="block max-w-full min-w-0 truncate text-xs font-medium text-blue-600">
                  {(message.reply_to as ReplyMessage).sender_display_name ||
                    userDisplayName((message.reply_to.sender as User) ?? { display_name: "", phone: "" })}
                </div>
                <div className="block max-w-full min-w-0 truncate text-xs text-slate-500">
                  {message.reply_to.msg_type === "gif"
                    ? "(GIF)"
                    : message.reply_to.msg_type === "sticker"
                      ? t("common.stickerMsg")
                      : message.reply_to.msg_type === "poll"
                        ? t("chat.poll")
                        : message.reply_to.msg_type !== "text" && message.reply_to.msg_type !== "emoji"
                        ? t("common.fileMsg")
                        : (message.reply_to.content || "").trim().slice(0, 80)}
                </div>
              </button>
            </div>
          )}
          {message.reply_to && message.reply_to.is_deleted && (
            <div className="mb-0.5 -mt-0.5 max-w-full min-w-0">
              <div className="w-full max-w-full min-w-0 rounded-lg border-l-[3px] border-slate-300 bg-slate-50/50 px-2 py-0.5 text-left">
                <div className="block max-w-full min-w-0 truncate text-xs italic text-slate-400">{t("chat.messageDeleted")}</div>
              </div>
            </div>
          )}
          {editing ? (
            <div className="min-w-[240px] max-w-full">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
                maxLength={MESSAGE_MAX_LENGTH}
                rows={8}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y min-h-[120px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCancelEdit();
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                }}
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button type="button" onClick={handleCancelEdit} className="text-xs text-slate-500 hover:text-slate-700">
                  Отмена
                </button>
                <button type="button" onClick={handleSaveEdit} className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600">
                  Сохранить
                </button>
              </div>
            </div>
          ) : isVideoCircle ? (
            <div className="min-w-0 max-w-full">
              {message.file ? (
                <VideoCirclePlayer
                  src={fileUrl}
                  ownerId={message.id}
                  durationSeconds={(message as { duration_seconds?: number | null }).duration_seconds ?? undefined}
                />
              ) : uploadProgress ? (
                <div className="relative inline-block">
                  <div className="w-[200px] h-[200px] rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
                    <div className="w-8 h-8 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 px-2 py-1 rounded-md bg-black/50 text-white text-xs">
                    <span className="flex-1 truncate">{((uploadProgress.loaded / uploadProgress.total) * 100).toFixed(0)}%</span>
                    {onCancelUpload && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onCancelUpload(message.id); }} className="shrink-0 p-0.5 rounded hover:bg-white/20" title={t("chat.cancelUpload")} aria-label={t("chat.cancelUpload")}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isVideo ? (
            <div className="min-w-0 max-w-full">
              <button
                type="button"
                className="relative block max-w-[300px] max-h-80 rounded-lg overflow-hidden"
                onClick={() => setVideoLightboxOpen(true)}
                aria-label={t("common.open")}
              >
                <InlineAutoplayVideo
                  src={fileUrl}
                  className="w-full h-full max-w-[300px] max-h-80 rounded-lg pointer-events-none"
                  controls={false}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/15 hover:bg-black/20 transition-colors">
                  <div className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                </div>
              </button>
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
              {videoLightboxOpen && createPortal(
                <VideoLightbox src={fileUrl} originalName={fileName || "video"} onClose={() => setVideoLightboxOpen(false)} />,
                document.body,
              )}
            </div>
          ) : isGif ? (
            <div className="min-w-0 max-w-full">
              <div className="max-w-[280px] max-h-80 rounded-xl overflow-hidden" style={{ maxHeight: "280px" }}>
                <ProgressiveImage
                  src={toSameOriginMediaUrl(content) || content}
                  alt=""
                  className="w-full h-full"
                  objectFit="contain"
                  fill
                  preserveAnimation
                  useOriginalQuality
                />
              </div>
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isSticker ? (
            <div className="min-w-0 max-w-full">
              {(() => {
                if (message.file && (message.file as { url?: string }).url) {
                  const stickerUrl = (message.file as { url: string }).url;
                  const mime = (message.file as { mime_type?: string }).mime_type || "";
                  const isLottie = mime.includes("application/json");
                  return isLottie
                    ? <LottieSticker animationUrl={stickerUrl} size={112} />
                    : <MediaImage source={stickerUrl} alt="" className="w-28 h-28 object-contain" lazy={false} />;
                }
                const stickerPath = content.startsWith("/") ? content : `/${(content || "").replace(/^\/+/, "")}`;
                const stickerAnim = getStickerAnimationUrl(stickerPath);
                return stickerAnim
                  ? <LottieSticker animationUrl={stickerAnim} size={112} />
                  : <MediaImage source={stickerPath} alt="" className="w-28 h-28 object-contain" lazy={false} />;
              })()}
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isPoll ? (
            <PollMessageContent
              message={message}
              chatId={chatId}
              onMessageUpdated={onMessageUpdated}
              timeEl={timeEl}
              hasReactions={hasReactions}
              reactionButtons={reactionButtons}
            />
          ) : isImageGroup ? (
            <div className="min-w-0 max-w-full">
              <div className="relative">
                <MemoImageTileGrid images={imageFiles} imagesKey={imageFilesKey} />
                {/* Time/reactions overlay on bottom-right of image grid */}
                <div className="absolute bottom-1.5 left-2 flex items-center gap-x-1 px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-white [&_span]:!text-white/90">
                  {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
                </div>
              </div>
            </div>
          ) : isSharedContact && sharedContact ? (
            <div className="min-w-0 max-w-full">
              <TelegramInfoCard
                isMine={isMine}
                href={sharedContact.href}
                leading={
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-lg ${isMine ? "bg-blue-200/80 text-blue-700" : "bg-slate-200/90 text-slate-600"}`}>
                    {sharedContact.name.trim().charAt(0).toUpperCase() || "👤"}
                  </div>
                }
                title={sharedContact.name}
                subtitle={`@${sharedContact.label}`}
              />
              <div className="mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : uploadProgress && message.msg_type === "audio" ? (
            <div className="min-w-0 max-w-full">
              <TelegramInfoCard
                isMine={isMine}
                leading={<FileTypeIconBox type="audio" isMine={isMine} />}
                title={fileName || content || t("common.voice")}
                subtitle={fileCardSubtitle}
                onClick={onCancelUpload ? () => onCancelUpload(message.id) : undefined}
                disabled={!onCancelUpload}
              />
              <div className="mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : uploadProgress && isFile && message.msg_type !== "audio" && message.msg_type !== "video_circle" ? (
            <div className="min-w-0 max-w-full">
              <TelegramInfoCard
                isMine={isMine}
                leading={<FileTypeIconBox type={getFileIconType(fileMime, fileName || content || "")} isMine={isMine} />}
                titleNode={<FileNameDisplay fileName={fileName || content || t("common.fileMsg")} />}
                subtitle={fileCardSubtitle}
                onClick={onCancelUpload ? () => onCancelUpload(message.id) : undefined}
                disabled={!onCancelUpload}
              />
              <div className="mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isFile && !isAudio && !isVideo && !isImageBubble && !uploadProgress && onDownloadWithProgress && !isMine ? (
            <div className="min-w-0 max-w-full">
              <TelegramInfoCard
                isMine={isMine}
                leading={<FileTypeIconBox type={getFileIconType(fileMime, fileName || "")} isMine={isMine} />}
                titleNode={<FileNameDisplay fileName={fileName || t("common.fileMsg")} />}
                subtitle={fileCardSubtitle}
                onClick={() => onDownloadWithProgress(message.id, fileUrl, fileName || content || "file")}
                disabled={!!downloadProgress}
              />
              <div className="mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isFile && !isAudio && !isVideo && !isImageBubble && !uploadProgress ? (
            <div className="min-w-0 max-w-full">
              <TelegramInfoCard
                isMine={isMine}
                leading={<FileTypeIconBox type={getFileIconType(fileMime, fileName || "")} isMine={isMine} />}
                titleNode={<FileNameDisplay fileName={fileName || t("common.fileMsg")} />}
                subtitle={fileCardSubtitle}
                href={fileUrl}
              />
              <div className="mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isFile && (message.file || uploadProgress) ? (
            <div className="min-w-0 max-w-full">
              {(uploadProgress || downloadProgress) && !(uploadProgress && message.msg_type === "audio") && !(uploadProgress && message.msg_type === "video_circle") && (
                <div className="text-xs text-slate-500 mb-0.5">
                  {(uploadProgress ? (uploadProgress.loaded / 1024 / 1024).toFixed(1) : (downloadProgress!.loaded / 1024 / 1024).toFixed(1))}
                  {" / "}
                  {(uploadProgress ? (uploadProgress.total / 1024 / 1024).toFixed(1) : (downloadProgress!.total / 1024 / 1024).toFixed(1))}
                  {" "}{t("chat.progressMB")}
                </div>
              )}
              {uploadProgress && message.msg_type === "audio" ? (
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0 justify-start">
                  <div className="relative flex items-center gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 py-1 px-2 rounded-xl bg-blue-100 text-slate-700 min-w-[120px]">
                      <FileTypeIconBox type="audio" isMine={isMine} />
                      <span className="text-xs tabular-nums">{(uploadProgress.loaded / 1024 / 1024).toFixed(1)} / {(uploadProgress.total / 1024 / 1024).toFixed(1)} МБ</span>
                    </div>
                    {onCancelUpload && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onCancelUpload(message.id); }} className="p-1.5 rounded-lg text-slate-500 hover:bg-red-100 hover:text-red-600 transition-colors" title={t("chat.cancelUpload")} aria-label={t("chat.cancelUpload")}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              ) : uploadProgress && message.msg_type !== "audio" ? (
                <div className="group flex items-center gap-2 min-w-[200px] max-w-full overflow-hidden rounded-lg py-0.5 opacity-90">
                  <div className="relative shrink-0 w-9 h-9 flex items-center justify-center rounded-lg">
                    <span className="block transition-opacity group-hover:opacity-0">
                      <FileTypeIconBox type={getFileIconType(fileMime, fileName || content || "")} isMine={isMine} />
                    </span>
                    {onCancelUpload && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onCancelUpload(message.id); }}
                        className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                        title={t("chat.cancelUpload")}
                        aria-label={t("chat.cancelUpload")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    )}
                  </div>
                  <FileNameDisplay fileName={fileName || content || t("common.fileMsg")} />
                </div>
              ) : isAudio ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    {!(message as { waveform?: number[] }).waveform?.length && (
                      <FileTypeIconBox type="audio" isMine={isMine} />
                    )}
                    {(message as { waveform?: number[] }).waveform?.length ? (
                      <AudioMessagePlayer
                        fileUrl={fileUrl}
                        waveform={(message as { waveform?: number[] }).waveform!}
                        durationSeconds={(message as { duration_seconds?: number | null }).duration_seconds ?? undefined}
                        isMine={isMine}
                        ownerId={message.id}
                      />
                    ) : (
                      <SimpleAudioPlayer
                        fileUrl={fileUrl}
                        durationSeconds={(message as { duration_seconds?: number | null }).duration_seconds ?? undefined}
                        isMine={isMine}
                        ownerId={message.id}
                      />
                    )}
                  </div>
                </>
              ) : onDownloadWithProgress && !isMine ? (
                <button
                  type="button"
                  onClick={() => onDownloadWithProgress(message.id, fileUrl, fileName || content || "file")}
                  disabled={!!downloadProgress}
                  className={`flex items-center gap-2 min-w-[200px] max-w-full overflow-hidden rounded-lg cursor-pointer py-0.5 text-left ${"text-blue-600 hover:bg-slate-50 hover:text-blue-800"} disabled:opacity-70`}
                  title={fileName || t("common.fileMsg")}
                  aria-label={fileName || t("common.fileMsg")}
                >
                  <FileTypeIconBox type={getFileIconType(fileMime, fileName || "")} isMine={isMine} />
                  <FileNameDisplay fileName={fileName} />
                </button>
              ) : (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 min-w-[200px] max-w-full overflow-hidden rounded-lg cursor-pointer py-0.5 ${isMine ? "text-blue-700 hover:bg-blue-200/80" : "text-blue-600 hover:bg-slate-50 hover:text-blue-800"}`}
                  title={fileName || t("common.fileMsg")}
                  aria-label={fileName || t("common.fileMsg")}
                >
                  <FileTypeIconBox type={getFileIconType(fileMime, fileName || "")} isMine={isMine} />
                  <FileNameDisplay fileName={fileName} />
                </a>
              )}
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isShortText && !message.link_preview?.url ? (
            <>
              <div className="inline-flex items-baseline gap-x-1.5 flex-nowrap leading-snug whitespace-nowrap">
                <MemoMarkdownMessageContent content={content} isMine={isMine} className="inline" inline />
                {timeEl}
              </div>
              {hasReactions && (
                <div className="flex flex-wrap gap-x-1 gap-y-0.5 mt-px animate-reactions-appear justify-start -ml-1 mr-1">
                  {reactionButtons}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="relative leading-snug max-w-full">
                <MemoMarkdownMessageContent
                  content={content}
                  isMine={isMine}
                  className="inline"
                  inline={!message.link_preview?.url}
                  linkPreview={message.link_preview ?? undefined}
                />
                <span className="invisible inline-flex items-center whitespace-nowrap ml-1.5 text-[0.625rem]">{timeEl}</span>
                <span className="absolute bottom-[1px] right-0 z-10">{timeEl}</span>
              </div>
              {hasReactions && (
                <div className="flex flex-wrap gap-x-1 gap-y-0.5 mt-px animate-reactions-appear justify-start -ml-1 mr-1">
                  {reactionButtons}
                </div>
              )}
            </>
          )}
          {hasCommentsFooter && (
            <button
              type="button"
              onClick={onOpenComments}
              className={`group block min-w-0 cursor-pointer text-left box-border ${commentsFooterLayoutClass} ${isLastInGroup ? "!rounded-bl-[4px]" : ""} ${
                isImageBubble || isSticker
                  ? `mt-0 border-t px-3 py-2 rounded-b-2xl transition-colors ${commentsFooterSurfaceClass}`
                  : `border-t px-3 py-2 rounded-b-2xl transition-colors ${commentsFooterSurfaceClass}`
              }`}
              title={t("channelComments.openDiscussion")}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-3 text-xs font-medium">
                <span className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="truncate">{t("channelComments.open")}</span>
                </span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 tabular-nums group-hover:bg-white/20 group-hover:text-white ${isMine ? "bg-blue-200/70 text-slate-700" : "bg-slate-200/80 text-slate-700"}`}>
                  {commentsCount}
                </span>
              </span>
            </button>
          )}
        </div>
        </div>
        )}
        {/* Reaction picker: own messages — справа от пузырька, если выравнивание слева; слева от пузырька, если свои сообщения прижаты вправо */}
        {isMine && pickerVisible && !editing && (
          <div
            className={`absolute bottom-1 z-20 flex items-center gap-1 ${alignRight ? "right-full mr-0.5" : "left-full ml-0.5"}`}
            onMouseEnter={() => {
              if (pickerHideTimerRef.current) {
                clearTimeout(pickerHideTimerRef.current);
                pickerHideTimerRef.current = null;
              }
              onOpenReactionPicker?.();
              setPickerHover(true);
            }}
            onMouseLeave={schedulePickerHide}
          >
            <div className="scrollbar-hide flex flex-col gap-0.5 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-lg py-1 px-1 overflow-y-auto max-h-[5.75rem]">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={reactionLoading || (!myReactions.includes(emoji) && !canAddReaction)}
                  onClick={() => handleReaction(emoji)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors shrink-0 ${myReactions.includes(emoji) ? "bg-blue-100 ring-1 ring-blue-300" : ""}`}
                  title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : t("chat.maxReactions")}
                >
                  <AnimatedReaction emoji={emoji} size={24} loop preferEmoji={emoji !== "🔥"} />
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Мост только при открытом пикере — чтобы не было нескольких активных зон наведения у разных сообщений */}
        {pickerVisible && (
          <div
            className={`absolute inset-y-0 w-56 min-h-[3rem] z-10 pointer-events-auto ${isMine && alignRight ? "right-full" : "left-full"}`}
            style={isMine && alignRight ? { marginRight: 0 } : { marginLeft: 0 }}
            aria-hidden
            onMouseEnter={() => {
              if (pickerHideTimerRef.current) {
                clearTimeout(pickerHideTimerRef.current);
                pickerHideTimerRef.current = null;
              }
              onOpenReactionPicker?.();
              setPickerHover(true);
            }}
            onMouseLeave={schedulePickerHide}
          />
        )}
        {!isMine && pickerVisible && (
          <div
            className="absolute bottom-1 left-full ml-0.5 z-20 flex items-center gap-1"
            onMouseEnter={() => {
              if (pickerHideTimerRef.current) {
                clearTimeout(pickerHideTimerRef.current);
                pickerHideTimerRef.current = null;
              }
              onOpenReactionPicker?.();
              setPickerHover(true);
            }}
            onMouseLeave={schedulePickerHide}
          >
            <div className="scrollbar-hide flex flex-col gap-0.5 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-lg py-1 px-1 overflow-y-auto max-h-[5.75rem]">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={reactionLoading || (!myReactions.includes(emoji) && !canAddReaction)}
                  onClick={() => handleReaction(emoji)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors shrink-0 ${myReactions.includes(emoji) ? "bg-blue-100 ring-1 ring-blue-300" : ""}`}
                  title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : t("chat.maxReactions")}
                >
                  <AnimatedReaction emoji={emoji} size={24} loop preferEmoji={emoji !== "🔥"} />
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      </div>
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[99] md:hidden"
            onClick={closeContextMenu}
            aria-hidden
          />
          <div
            ref={menuRef}
            className="context-menu-bottom-sheet fixed z-[100] min-w-[200px] py-1 bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col max-h-[70vh] overflow-y-auto"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* 1. Reply */}
          {onReply && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              onClick={() => { closeContextMenu(); onReply(message); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
              Ответить
            </button>
          )}
          {/* 2. Forward */}
          {onEnterSelectionMode && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              onClick={() => { closeContextMenu(); onEnterSelectionMode(message.id); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              {t("chat.select")}
            </button>
          )}
          {onForward && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              onClick={() => { closeContextMenu(); onForward(message); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              {t("chat.forward")}
            </button>
          )}
          {/* 3. Copy */}
          <button
            type="button"
            className={`w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2 ${contextMenuCopyShake ? "animate-username-shake" : ""}`}
            onClick={() => {
              const text = isFile ? t("common.fileMsg") : (message.content || "");
              copyToClipboard(text).then(() => {
                setContextMenuCopyShake(true);
                setTimeout(() => setContextMenuCopyShake(false), 400);
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            {contextMenuCopied ? t("common.copied") : t("common.copy")}
          </button>
          {/* 4. Copy for Word */}
          <button
            type="button"
            className={`w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2 ${contextMenuCopyShake ? "animate-username-shake" : ""}`}
            onClick={() => {
              const raw = isFile ? t("common.fileMsg") : (message.content || "");
              const text = isFile ? raw : stripMarkdown(raw);
              copyToClipboard(text).then(() => {
                setContextMenuCopyShake(true);
                setTimeout(() => setContextMenuCopyShake(false), 400);
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            {t("chat.copyForWord")}
          </button>
          {/* 5. Edit */}
          {canEdit && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              onClick={() => {
                closeContextMenu();
                if (onStartEditInInput) {
                  onStartEditInInput(message.id, (message.content || "").trim());
                } else {
                  setEditing(true);
                }
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
{t("chat.editMessage")}
              </button>
          )}
          {/* 6. Delete */}
          {isMine && onMessageDeleted && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              onClick={handleDelete}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              Удалить сообщение
            </button>
          )}
          {/* 7. Pin actions */}
          {(() => {
            const isPinnedByMe = (myPinnedIds ?? []).includes(message.id);
            const isPinnedForAll = (pinnedForAllIds ?? []).includes(message.id);
            const canPinMore = (pinnedForAllIds ?? []).length < (maxPins ?? 1);
            return (
              <>
                {!isPinnedByMe && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                    onClick={() => {
                      closeContextMenu();
                      messagesApi.pin(chatId, message.id, "me").then(() => onPinChange?.());
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V17"/><path d="M12 2v5"/></svg>
                    Закрепить для себя
                  </button>
                )}
                {isPinnedByMe && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                    onClick={() => {
                      closeContextMenu();
                      messagesApi.unpin(chatId, message.id, "me").then(() => onPinChange?.());
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V17"/><path d="M12 2v5"/></svg>
                    Открепить для себя
                  </button>
                )}
                {canPinForAll && !isPinnedForAll && canPinMore && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                    onClick={() => {
                      closeContextMenu();
                      messagesApi.pin(chatId, message.id, "all").then(() => onPinChange?.());
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V17"/><path d="M12 2v5"/></svg>
                    Закрепить для всех
                  </button>
                )}
                {canPinForAll && isPinnedForAll && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                    onClick={() => {
                      closeContextMenu();
                      messagesApi.unpin(chatId, message.id, "all").then(() => onPinChange?.());
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V17"/><path d="M12 2v5"/></svg>
                    Открепить для всех
                  </button>
                )}
              </>
            );
          })()}
          {isMine && (message.read_by?.length ?? 0) > 0 && (
            <>
              <div className="border-t border-slate-100 mt-0.5" />
              <div className="px-2 py-1.5 text-xs">
                <div className="font-medium text-slate-600 mb-1 px-1">Просмотрели</div>
                <div className="max-h-32 overflow-y-auto overflow-x-hidden scrollbar-hide rounded">
                  {message.read_by!.map((u) => (
                    <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-slate-700">
                      {(u.avatar_url ?? u.avatar) ? (
                        <MediaImage
                          source={getAvatarUrlBySize(u.avatar_url ?? u.avatar, u.avatar_url_small, u.avatar_url_medium, "small")}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover shrink-0"
                          lazy={false}
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[0.625rem] font-semibold shrink-0">
                          {getAvatarInitials(userDisplayName(u) || u.telegram_username || u.id)}
                        </div>
                      )}
                      <span className="truncate min-w-0">{userDisplayName(u) || u.telegram_username || u.id}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        </>
      )}
      {reactionLimitToast && createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[500] px-4 py-2.5 bg-slate-800 text-white text-sm rounded-lg shadow-lg whitespace-nowrap animate-in fade-in duration-200" role="alert">
          Максимум 3 реакции от одного пользователя
        </div>,
        document.body
      )}
    </div>
  );
});

/* ================================================================
   VideoCirclePlayer — circle video (video note)
   ================================================================ */

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type ExclusiveSoundStopFn = () => void;

const exclusiveSound = (() => {
  let currentId: string | null = null;
  const stopHandlers = new Map<string, ExclusiveSoundStopFn>();
  return {
    register(id: string, stop: ExclusiveSoundStopFn) {
      stopHandlers.set(id, stop);
      return () => {
        stopHandlers.delete(id);
        if (currentId === id) currentId = null;
      };
    },
    request(id: string) {
      if (currentId && currentId !== id) stopHandlers.get(currentId)?.();
      currentId = id;
    },
    release(id: string) {
      if (currentId === id) currentId = null;
    },
    isCurrent(id: string) {
      return currentId === id;
    },
  };
})();

/** Количество шагов ползунка перемотки по волне (голосовые сообщения) */
const WAVEFORM_SEEK_STEPS = 1000;

/* ================================================================
   SimpleAudioPlayer — audio without waveform: play button, progress bar, duration
   ================================================================ */

function SimpleAudioPlayer({ fileUrl, durationSeconds, isMine, ownerId }: { fileUrl: string; durationSeconds?: number; isMine: boolean; ownerId: string }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);
  const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const waveform = useMemo(() => {
    const count = 48;
    let seed = 0;
    for (let i = 0; i < fileUrl.length; i++) seed = (seed * 31 + fileUrl.charCodeAt(i)) >>> 0;
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = 40 + (seed % 180);
      values.push(v);
    }
    return values;
  }, [fileUrl]);

  const syncDuration = useCallback((el: HTMLAudioElement) => {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const unregister = exclusiveSound.register(ownerId, () => {
      try { el.pause(); } catch {}
    });
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(durationSeconds ?? 0);
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
    };
    const onLoadedMetadata = () => syncDuration(el);
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); exclusiveSound.release(ownerId); };
    const onPlay = () => { exclusiveSound.request(ownerId); setIsPlaying(true); };
    const onPause = () => { setIsPlaying(false); exclusiveSound.release(ownerId); };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    try { el.load(); } catch {}
    syncDuration(el);
    return () => {
      unregister();
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [fileUrl, durationSeconds, syncDuration, ownerId]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      exclusiveSound.request(ownerId);
      el.play();
    }
    else el.pause();
  };

  const handleSeek = (percent: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0) return;
    const time = Math.max(0, Math.min(effectiveDuration, percent * effectiveDuration));
    el.currentTime = time;
    setCurrentTime(time);
  };

  return (
    <div className="flex items-center gap-2.5 my-0.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={fileUrl} preload="metadata" crossOrigin="anonymous" className="absolute w-0 h-0 opacity-0 pointer-events-none" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isMine ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
        }`}
        aria-label={isPlaying ? t("chat.pause") : t("chat.play")}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="relative flex items-end gap-[2px] h-5 w-full min-w-0 select-none">
          <div className="flex items-end gap-[2px] h-5 w-full min-w-0 pointer-events-none">
            {waveform.map((v, i) => {
              const played = (i + 1) / waveform.length <= progress;
              return (
                <div
                  key={i}
                  className={`w-[3px] rounded-full min-h-[2px] transition-colors ${played ? (isMine ? "bg-blue-600" : "bg-slate-500") : "bg-slate-300"}`}
                  style={{ height: `${Math.max(2, (v / 255) * 16)}px` }}
                />
              );
            })}
          </div>
          <input
            type="range"
            min={0}
            max={WAVEFORM_SEEK_STEPS}
            step={1}
            value={Math.round(progress * WAVEFORM_SEEK_STEPS)}
            onChange={(e) => handleSeek(Number(e.target.value) / WAVEFORM_SEEK_STEPS)}
            aria-label={t("chat.seekWave")}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className={`text-xs tabular-nums ${isMine ? "text-slate-600" : "text-slate-500"}`}>
          {formatAudioTime(currentTime)} / {effectiveDuration > 0 ? formatAudioTime(effectiveDuration) : "…"}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   AudioWaveform — волны как ползунок: клик по области волн перематывает на этот момент (нативный range поверх)
   ================================================================ */

function AudioWaveform({
  waveform,
  isMine,
  progress = 0,
  onSeek,
}: {
  waveform: number[];
  isMine: boolean;
  progress?: number;
  onSeek?: (percent: number) => void;
}) {
  const { t } = useTranslation();
  if (!waveform.length) return null;
  const maxH = 20;
  const n = waveform.length;
  const playedCls = isMine ? "bg-blue-600" : "bg-slate-500";
  const unplayedCls = "bg-slate-300";

  const rangeValue = Math.round(progress * WAVEFORM_SEEK_STEPS);
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onSeek) return;
    const percent = Number(e.target.value) / WAVEFORM_SEEK_STEPS;
    onSeek(Math.max(0, Math.min(1, percent)));
  };

  return (
    <div className="relative flex items-end gap-0.5 h-5 w-full min-w-0 select-none">
      {/* Визуальные волны (не перехватывают клик) */}
      <div className="flex items-end gap-0.5 h-5 w-full min-w-0 pointer-events-none">
        {waveform.map((v, i) => {
          const played = (i + 1) / n <= progress;
          return (
            <div
              key={i}
              className={`w-1 rounded-full min-h-[2px] transition-colors ${played ? playedCls : unplayedCls}`}
              style={{ height: `${Math.max(2, (v / 255) * maxH)}px` }}
            />
          );
        })}
      </div>
      {/* Ползунок поверх волн: клик = перемотка на этот момент (готовый инструмент) */}
      {onSeek && (
        <input
          type="range"
          min={0}
          max={WAVEFORM_SEEK_STEPS}
          step={1}
          value={rangeValue}
          onChange={handleRangeChange}
          aria-label={t("chat.seekWave")}
          className="absolute inset-0 w-full h-full cursor-pointer opacity-0 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:cursor-pointer"
        />
      )}
    </div>
  );
}

/* ================================================================
   AudioMessagePlayer — waveform + separate play button, no white block
   ================================================================ */

function AudioMessagePlayer({ fileUrl, waveform, durationSeconds, isMine, ownerId }: { fileUrl: string; waveform: number[]; durationSeconds?: number; isMine: boolean; ownerId: string }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);
  const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

  const syncDuration = useCallback((el: HTMLAudioElement) => {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const unregister = exclusiveSound.register(ownerId, () => {
      try { el.pause(); } catch {}
    });
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(durationSeconds ?? 0);
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
    };
    const onLoadedMetadata = () => syncDuration(el);
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); exclusiveSound.release(ownerId); };
    const onPlay = () => { exclusiveSound.request(ownerId); setIsPlaying(true); };
    const onPause = () => { setIsPlaying(false); exclusiveSound.release(ownerId); };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    try { el.load(); } catch {}
    syncDuration(el);
    return () => {
      unregister();
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [fileUrl, durationSeconds, syncDuration, ownerId]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      exclusiveSound.request(ownerId);
      el.play();
    }
    else el.pause();
  };

  const handleSeek = (percent: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0) return;
    const time = Math.max(0, Math.min(effectiveDuration, percent * effectiveDuration));
    el.currentTime = time;
    setCurrentTime(time);
  };

  return (
    <div className="flex items-center gap-2.5 my-0.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={fileUrl} preload="metadata" crossOrigin="anonymous" className="absolute w-0 h-0 opacity-0 pointer-events-none" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isMine ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
        }`}
        aria-label={isPlaying ? t("chat.pause") : t("chat.play")}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <AudioWaveform waveform={waveform} isMine={isMine} progress={progress} onSeek={handleSeek} />
        <div className={`text-xs tabular-nums ${isMine ? "text-slate-600" : "text-slate-500"}`}>
          {formatAudioTime(currentTime)} / {effectiveDuration > 0 ? formatAudioTime(effectiveDuration) : "…"}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ImageTileGrid — tile layout for multiple images
   ================================================================ */

/**
 * Telegram-style adaptive image tile grid.
 * Calculates container dimensions from actual image aspect ratios to minimize cropping.
 * Total height capped at 33vh. Width adapts to fit natural proportions.
 */
const TILE_MIN_W = 200;
const TILE_MAX_W = 560;
const TILE_GAP = 1;

type ImgDims = { w: number; h: number; ratio: number };

function useMaxTileH() {
  const [maxH, setMaxH] = useState(Math.round(window.innerHeight / 3));
  useEffect(() => {
    const handler = () => setMaxH(Math.round(window.innerHeight / 3));
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return maxH;
}

type ImageTileItem = { id: string; url?: string | null; original_name?: string; mime_type?: string; width_px?: number; height_px?: number };

function ImageTileGrid({ images }: { images: ImageTileItem[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const maxShow = 6;
  const visibleImages = images.slice(0, maxShow);
  const hiddenCount = images.length - maxShow;
  const maxH = useMaxTileH();

  const initialDims = useMemo(
    () =>
      visibleImages.map((img) =>
        img.width_px != null && img.height_px != null && img.width_px > 0 && img.height_px > 0
          ? { w: img.width_px, h: img.height_px, ratio: img.width_px / img.height_px }
          : null
      ),
    [visibleImages.map((i) => `${i.id}:${i.width_px}:${i.height_px}`).join("|")]
  );

  const [loadedDims, setLoadedDims] = useState<(ImgDims | null)[]>([]);
  const imagesKey = visibleImages.map((i) => i.id).join(",");

  useEffect(() => {
    setLoadedDims([]);
  }, [imagesKey]);

  useEffect(() => {
    const needLoad = visibleImages.map((_, idx) => initialDims[idx] == null);
    if (!needLoad.some(Boolean)) return;
    let cancelled = false;
    const results: (ImgDims | null)[] = new Array(visibleImages.length).fill(null);
    let loaded = 0;
    const toLoadCount = needLoad.filter(Boolean).length;
    visibleImages.forEach((img, idx) => {
      if (!needLoad[idx]) return;
      resolveMediaAccess(img.url ?? null)
        .then((resolved) => {
          const url = toSameOriginMediaUrl(resolved || img.url || "#") || "#";
          if (!url || url === "#") {
            results[idx] = { w: 400, h: 300, ratio: 4 / 3 };
            loaded++;
            if (loaded === toLoadCount && !cancelled) setLoadedDims([...results]);
            return;
          }
          const el = new Image();
          el.onload = () => {
            if (cancelled) return;
            results[idx] = { w: el.naturalWidth, h: el.naturalHeight, ratio: el.naturalWidth / el.naturalHeight };
            loaded++;
            if (loaded === toLoadCount) setLoadedDims([...results]);
          };
          el.onerror = () => {
            if (cancelled) return;
            results[idx] = { w: 400, h: 300, ratio: 4 / 3 };
            loaded++;
            if (loaded === toLoadCount) setLoadedDims([...results]);
          };
          el.src = url;
        })
        .catch(() => {
          if (cancelled) return;
          results[idx] = { w: 400, h: 300, ratio: 4 / 3 };
          loaded++;
          if (loaded === toLoadCount) setLoadedDims([...results]);
        });
    });
    return () => { cancelled = true; };
  }, [imagesKey]);

  const dims = useMemo(
    () =>
      visibleImages.map((_, i) => initialDims[i] ?? loadedDims[i] ?? { w: 400, h: 300, ratio: 4 / 3 }),
    [initialDims, loadedDims, visibleImages.length]
  );

  const count = visibleImages.length;
  const d = (i: number): ImgDims => dims[i] ?? { w: 400, h: 300, ratio: 4 / 3 };

  const clampW = (w: number) => Math.min(Math.max(w, TILE_MIN_W), TILE_MAX_W);

  const renderTile = (img: typeof visibleImages[0], idx: number, style: React.CSSProperties) => {
    const url = img.url || "#";
    const isLast = idx === maxShow - 1 && hiddenCount > 0;
    return (
      <div key={img.id} className="relative cursor-pointer overflow-hidden" style={style} onClick={() => setLightboxIdx(idx)}>
        <ProgressiveImage
          src={url}
          alt={img.original_name || ""}
          className="w-full h-full hover:scale-105 transition-transform duration-200"
          objectFit="cover"
          fullWidth={2560}
          useOriginalQuality
          preserveAnimation={(img.mime_type || "").includes("gif") || /\.gif$/i.test(img.original_name || "")}
        />
        {isLast && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-2xl font-bold">+{hiddenCount}</span>
          </div>
        )}
      </div>
    );
  };

  const buildLayout = (): React.ReactNode => {
    if (count === 1) {
      const r = d(0).ratio;
      let h = Math.min(maxH, 400);
      let w = clampW(h * r);
      h = Math.min(w / r, maxH);
      return (
        <div className="flex rounded-xl overflow-hidden" style={{ width: w, height: h }}>
          {renderTile(visibleImages[0], 0, { width: "100%", height: "100%" })}
        </div>
      );
    }

    if (count === 2) {
      const r0 = d(0).ratio;
      const r1 = d(1).ratio;
      const bothLandscape = r0 > 1.1 && r1 > 1.1;
      const bothPortrait = r0 < 0.85 && r1 < 0.85;

      if (bothLandscape) {
        let h0 = (maxH - TILE_GAP) / 2;
        let h1 = h0;
        let w0 = h0 * r0;
        let w1 = h1 * r1;
        let w = clampW(Math.max(w0, w1));
        h0 = Math.min(w / r0, h0);
        h1 = Math.min(w / r1, h1);
        return (
          <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: w, gap: TILE_GAP }}>
            {renderTile(visibleImages[0], 0, { width: "100%", height: h0 })}
            {renderTile(visibleImages[1], 1, { width: "100%", height: h1 })}
          </div>
        );
      }

      if (bothPortrait) {
        let targetH = Math.min(maxH, 380);
        let w0 = targetH * r0;
        let w1 = targetH * r1;
        let totalW = w0 + w1 + TILE_GAP;
        if (totalW > TILE_MAX_W) {
          const s = TILE_MAX_W / totalW;
          w0 *= s; w1 *= s; totalW = TILE_MAX_W; targetH *= s;
        }
        return (
          <div className="flex flex-row rounded-xl overflow-hidden" style={{ width: totalW, height: targetH, gap: TILE_GAP }}>
            {renderTile(visibleImages[0], 0, { width: w0, height: "100%" })}
            {renderTile(visibleImages[1], 1, { width: w1, height: "100%" })}
          </div>
        );
      }

      let targetH = Math.min(maxH, 320);
      let w0 = targetH * r0;
      let w1 = targetH * r1;
      let totalW = w0 + w1 + TILE_GAP;
      if (totalW > TILE_MAX_W) {
        const s = TILE_MAX_W / totalW;
        w0 *= s; w1 *= s; totalW = TILE_MAX_W; targetH *= s;
      }
      if (totalW < TILE_MIN_W) {
        const s = TILE_MIN_W / totalW;
        w0 *= s; w1 *= s; totalW = TILE_MIN_W; targetH *= s;
      }
      return (
        <div className="flex flex-row rounded-xl overflow-hidden" style={{ width: totalW, height: targetH, gap: TILE_GAP }}>
          {renderTile(visibleImages[0], 0, { width: w0, height: "100%" })}
          {renderTile(visibleImages[1], 1, { width: w1, height: "100%" })}
        </div>
      );
    }

    if (count === 3) {
      const r0 = d(0).ratio;
      let topH = Math.min((maxH - TILE_GAP) * 0.6, 260);
      let w = clampW(topH * r0);
      topH = Math.min(w / r0, topH);
      let botH = Math.min((maxH - TILE_GAP) * 0.4, 180);
      if (topH + botH + TILE_GAP > maxH) {
        const s = maxH / (topH + botH + TILE_GAP);
        topH *= s; botH *= s;
      }
      return (
        <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: w, gap: TILE_GAP }}>
          {renderTile(visibleImages[0], 0, { width: "100%", height: topH })}
          <div className="flex flex-row" style={{ gap: TILE_GAP, height: botH }}>
            {renderTile(visibleImages[1], 1, { flex: 1, height: "100%" })}
            {renderTile(visibleImages[2], 2, { flex: 1, height: "100%" })}
          </div>
        </div>
      );
    }

    if (count === 4) {
      const avgR = (d(0).ratio + d(1).ratio + d(2).ratio + d(3).ratio) / 4;
      let rowH = Math.min((maxH - TILE_GAP) / 2, 200);
      let w = clampW(rowH * avgR * 2 + TILE_GAP);
      rowH = Math.min((maxH - TILE_GAP) / 2, rowH);
      return (
        <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: w, gap: TILE_GAP }}>
          <div className="flex flex-row" style={{ gap: TILE_GAP, height: rowH }}>
            {renderTile(visibleImages[0], 0, { flex: 1, height: "100%" })}
            {renderTile(visibleImages[1], 1, { flex: 1, height: "100%" })}
          </div>
          <div className="flex flex-row" style={{ gap: TILE_GAP, height: rowH }}>
            {renderTile(visibleImages[2], 2, { flex: 1, height: "100%" })}
            {renderTile(visibleImages[3], 3, { flex: 1, height: "100%" })}
          </div>
        </div>
      );
    }

    const topRow = visibleImages.slice(0, 3);
    const botRow = visibleImages.slice(3);
    let rowH = Math.min((maxH - TILE_GAP) / 2, 160);
    const w = clampW(rowH * 3 * 1.3);
    return (
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: w, gap: TILE_GAP }}>
        <div className="flex flex-row" style={{ gap: TILE_GAP, height: rowH }}>
          {topRow.map((img, i) => renderTile(img, i, { flex: 1, height: "100%" }))}
        </div>
        {botRow.length > 0 && (
          <div className="flex flex-row" style={{ gap: TILE_GAP, height: rowH }}>
            {botRow.map((img, i) => renderTile(img, i + 3, { flex: 1, height: "100%" }))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {buildLayout()}
      {lightboxIdx !== null && createPortal(
        <ImageLightbox images={images} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />,
        document.body,
      )}
    </>
  );
}

function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: { id: string; url?: string | null; original_name?: string }[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(initialIndex);
  const img = images[idx];
  const resolvedUrl = useMediaAccess(img?.url ?? null, { enabled: !!img?.url });
  const url = resolvedUrl ? (toSameOriginMediaUrl(resolvedUrl) || resolvedUrl) : "#";
  const downloadName = (img?.original_name || `image-${idx + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
  const canDownload = url && url !== "#";

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && idx < images.length - 1) setIdx(idx + 1);
      if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [idx, images.length, onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center rounded-xl overflow-hidden bg-black/40 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <ProgressiveImage
          src={url}
          alt={img?.original_name || ""}
          className="max-w-full max-h-[80vh] object-contain rounded-lg"
          loading="eager"
          preserveAnimation={/\.gif$/i.test(img?.original_name || "")}
          useOriginalQuality
        />

        {/* Navigation */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(idx - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        )}
        {idx < images.length - 1 && (
          <button
            onClick={() => setIdx(idx + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        )}

        {/* Counter */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-3 py-1 rounded-full">
          {idx + 1} / {images.length}
        </div>
      </div>
      {/* Close — in screen corner, not over content */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="fixed top-4 right-4 z-[101] bg-white/90 hover:bg-white text-slate-800 rounded-full w-9 h-9 flex items-center justify-center shadow-lg transition-colors"
        aria-label={t("common.close")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      {/* Download — in bottom-right corner */}
      <a
        href={canDownload ? url : undefined}
        download={canDownload ? downloadName : undefined}
        target={canDownload ? "_blank" : undefined}
        rel={canDownload ? "noopener noreferrer" : undefined}
        onClick={(e) => e.stopPropagation()}
        aria-disabled={!canDownload}
        className={`fixed bottom-4 right-4 z-[101] bg-white/90 hover:bg-white text-slate-800 rounded-full w-10 h-10 flex items-center justify-center shadow-lg transition-colors ${
          canDownload ? "" : "opacity-50 pointer-events-none"
        }`}
        title={t("common.download")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    </div>
  );
}

function VideoLightbox({
  src,
  originalName,
  onClose,
}: {
  src: string;
  originalName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const resolvedUrl = useMediaAccess(src || null, { enabled: !!src });
  const url = resolvedUrl ? (toSameOriginMediaUrl(resolvedUrl) || resolvedUrl) : "#";
  const downloadName = (originalName || "video").replace(/[\\/:*?"<>|]+/g, "_");
  const canDownload = url && url !== "#";

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" onClick={onClose}>
      <div className="relative w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        <video
          src={url}
          className="max-w-full max-h-full object-contain rounded-lg"
          controls
          playsInline
          autoPlay
        />
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="fixed top-4 right-4 z-[101] bg-white/90 hover:bg-white text-slate-800 rounded-full w-9 h-9 flex items-center justify-center shadow-lg transition-colors"
        aria-label={t("common.close")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <a
        href={canDownload ? url : undefined}
        download={canDownload ? downloadName : undefined}
        target={canDownload ? "_blank" : undefined}
        rel={canDownload ? "noopener noreferrer" : undefined}
        onClick={(e) => e.stopPropagation()}
        aria-disabled={!canDownload}
        className={`fixed bottom-4 right-4 z-[101] bg-white/90 hover:bg-white text-slate-800 rounded-full w-10 h-10 flex items-center justify-center shadow-lg transition-colors ${
          canDownload ? "" : "opacity-50 pointer-events-none"
        }`}
        title={t("common.download")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    </div>
  );
}

function VideoCirclePlayer({ src, ownerId, durationSeconds }: { src: string; ownerId: string; durationSeconds?: number }) {
  const R = 46;
  const strokeWidth = 4;
  const resolvedUrl = useMediaAccess(src || null, { enabled: !!src });
  const videoUrl = resolvedUrl ? (toSameOriginMediaUrl(resolvedUrl) || resolvedUrl) : "";
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);
  const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const isDraggingRef = useRef(false);
  const dragStartedRef = useRef(false);
  const ringInteractionRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const downXYRef = useRef({ x: 0, y: 0 });
  const pendingPlayRef = useRef(false);
  const wasDragRef = useRef(false);
  const isSeekingRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const unregister = exclusiveSound.register(ownerId, () => {
      try { el.pause(); } catch {}
      el.muted = true;
      setMuted(true);
      setPlaying(false);
    });
    return () => {
      unregister();
      exclusiveSound.release(ownerId);
    };
  }, [ownerId]);

  const syncDuration = useCallback((el: HTMLVideoElement) => {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setPlaying(false);
    setMuted(true);
    setCurrentTime(0);
    setDuration(durationSeconds ?? 0);
    pendingSeekTimeRef.current = null;
    const onTimeUpdate = () => {
      if (isSeekingRef.current) return;
      setCurrentTime(el.currentTime);
    };
    const onSeeking = () => { isSeekingRef.current = true; };
    const onSeeked = () => {
      isSeekingRef.current = false;
      if (pendingSeekTimeRef.current != null && Math.abs(el.currentTime - pendingSeekTimeRef.current) <= 0.25) {
        pendingSeekTimeRef.current = null;
      }
      setCurrentTime(el.currentTime);
    };
    const applyPendingSeek = () => {
      if (pendingSeekTimeRef.current == null) return;
      const pendingTime = pendingSeekTimeRef.current;
      if (!(Number.isFinite(pendingTime) && pendingTime >= 0)) return;
      try {
        el.currentTime = pendingTime;
        setCurrentTime(pendingTime);
      } catch {
        // Some browsers temporarily reject seeks until media becomes ready.
      }
    };
    const onLoadedMetadata = () => {
      syncDuration(el);
      applyPendingSeek();
    };
    const onLoadedData = () => applyPendingSeek();
    const onCanPlay = () => applyPendingSeek();
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      pendingSeekTimeRef.current = null;
      exclusiveSound.release(ownerId);
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("loadeddata", onLoadedData);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    try { el.load(); } catch {}
    syncDuration(el);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("loadeddata", onLoadedData);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
    };
  }, [src, durationSeconds, syncDuration, ownerId]);

  /* When leaving the visible area — pause and reset audio */
  useEffect(() => {
    const el = videoRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (!e.isIntersecting) {
          el.pause();
          setPlaying(false);
          if (!muted) {
            el.muted = true;
            setMuted(true);
            exclusiveSound.release(ownerId);
          }
        }
      },
      { threshold: 0.25, rootMargin: "50px" }
    );
    io.observe(container);
    return () => io.disconnect();
  }, [src, muted, ownerId]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused && muted) {
      exclusiveSound.request(ownerId);
      v.muted = false;
      v.volume = 1;
      setMuted(false);
      return;
    }
    if (v.paused) {
      exclusiveSound.request(ownerId);
      v.muted = false;
      v.volume = 1;
      setMuted(false);
      v.play()
        .then(() => setPlaying(true))
        .catch(() => {
          v.muted = true;
          setMuted(true);
          exclusiveSound.release(ownerId);
          v.play().then(() => setPlaying(true)).catch(() => {});
        });
      return;
    }
    v.pause();
    setPlaying(false);
    exclusiveSound.release(ownerId);
    v.muted = true;
    setMuted(true);
  };

  const getPercentFromEvent = useCallback((clientX: number, clientY: number): number => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const angleRad = Math.atan2(dy, dx);
    const normalizedAngle = (angleRad + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    const percent = normalizedAngle / (2 * Math.PI);
    return Math.max(0, Math.min(1, percent));
  }, []);

  const isPointOnSeekRing = useCallback((clientX: number, clientY: number): boolean => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const distance = Math.hypot(dx, dy);
    const visualRadius = Math.min(rect.width, rect.height) * (R / 100);
    const hitPadding = Math.max(10, Math.min(rect.width, rect.height) * 0.04);
    const minDistance = visualRadius - strokeWidth * 2 - hitPadding;
    const maxDistance = visualRadius + strokeWidth * 2 + hitPadding;
    return distance >= minDistance && distance <= maxDistance;
  }, [R, strokeWidth]);

  const seekToPercent = useCallback((percent: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0) return;
    const time = Math.max(0, Math.min(effectiveDuration, percent * effectiveDuration));
    isSeekingRef.current = true;
    pendingSeekTimeRef.current = time;
    v.currentTime = time;
    setCurrentTime(time);
  }, [effectiveDuration]);

  const clearDragState = useCallback(() => {
    const el = containerRef.current;
    if (el && pointerIdRef.current != null) {
      try { el.releasePointerCapture(pointerIdRef.current); } catch { /* ignore */ }
    }
    pointerIdRef.current = null;
    dragStartedRef.current = false;
    isDraggingRef.current = false;
    ringInteractionRef.current = false;
  }, []);

  const handleCirclePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    isDraggingRef.current = false;
    dragStartedRef.current = true;
    wasDragRef.current = false;
    pendingPlayRef.current = false;
    pointerIdRef.current = e.pointerId;
    downXYRef.current = { x: e.clientX, y: e.clientY };
    ringInteractionRef.current = isPointOnSeekRing(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (ringInteractionRef.current) {
      isDraggingRef.current = true;
      wasDragRef.current = true;
      seekToPercent(getPercentFromEvent(e.clientX, e.clientY));
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleCirclePointerMove = (e: React.PointerEvent) => {
    if (!dragStartedRef.current) return;
    if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) return;
    if (!ringInteractionRef.current) return;
    seekToPercent(getPercentFromEvent(e.clientX, e.clientY));
  };

  const handleCirclePointerUp = () => {
    const wasDrag = isDraggingRef.current;
    const wasRingInteraction = ringInteractionRef.current;
    clearDragState();
    if (wasDrag) {
      wasDragRef.current = true;
    } else if (!wasRingInteraction) {
      pendingPlayRef.current = true;
    }
  };

  const handleCircleClick = (e: React.MouseEvent) => {
    if (wasDragRef.current) {
      wasDragRef.current = false;
      e.preventDefault();
      return;
    }
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      togglePlay();
    }
  };

  const handleCirclePointerCancel = (_e: React.PointerEvent) => {
    clearDragState();
  };
  const circumference = 2 * Math.PI * R;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const progressOffset = circumference * (1 - clampedProgress);
  const thumbAngle = -Math.PI / 2 + clampedProgress * 2 * Math.PI;
  const thumbX = 50 + R * Math.cos(thumbAngle);
  const thumbY = 50 + R * Math.sin(thumbAngle);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        className="relative w-48 h-48 rounded-full overflow-hidden cursor-pointer group bg-black select-none touch-none"
        onPointerDown={handleCirclePointerDown}
        onPointerMove={handleCirclePointerMove}
        onPointerUp={handleCirclePointerUp}
        onPointerCancel={handleCirclePointerCancel}
        onClick={handleCircleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePlay(); } }}
      >
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          className="w-full h-full object-cover pointer-events-none"
          preload="auto"
          crossOrigin="anonymous"
          playsInline
          muted={muted}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
        />
        {/* Circular progress ring (Telegram-style) — around the circle, seekable */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={strokeWidth}
            transform="rotate(-90 50 50)"
          />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="rgba(96,165,250,0.9)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={progressOffset}
            transform="rotate(-90 50 50)"
            className={ringInteractionRef.current ? "" : "transition-[stroke-dashoffset] duration-75"}
          />
          <circle
            cx={thumbX}
            cy={thumbY}
            r="2.6"
            fill="rgba(255,255,255,0.96)"
            className={ringInteractionRef.current ? "" : "transition-[cx,cy] duration-75"}
          />
        </svg>
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors rounded-full pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none">
              <polygon points="8 5 19 12 8 19 8 5" />
            </svg>
          </div>
        )}
        {muted && (
          <div className="absolute bottom-2 right-2 bg-black/45 text-white rounded-full p-1.5 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          </div>
        )}
      </div>
      <div className="text-xs text-slate-500 text-center">
        {formatAudioTime(currentTime)} / {effectiveDuration > 0 ? formatAudioTime(effectiveDuration) : "…"}
      </div>
    </div>
  );
}

/* ================================================================
   ScheduleMessageModal — scheduled/recurring message form
   ================================================================ */

function ScheduleMessageModal({
  chatId,
  initialContent,
  onClose,
  onSaved,
}: {
  chatId: string;
  initialContent: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useTranslation();
  const [content, setContent] = useState(initialContent);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [recurrenceTime, setRecurrenceTime] = useState("09:00");
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const weekdays = getWeekdays(lang);

  useEffect(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    d.setSeconds(0, 0);
    const pad = (n: number) => n.toString().padStart(2, "0");
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setScheduledTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }, []);

  // For recurrence, use the time from the selected time
  useEffect(() => {
    if (recurrence !== "none" && scheduledTime) setRecurrenceTime(scheduledTime);
  }, [recurrence, scheduledTime]);

  const scheduledAt = scheduledDate && scheduledTime ? `${scheduledDate}T${scheduledTime}` : "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const text = content.trim();
    if (!text) {
      setError(t("chat.scheduleEnterText"));
      return;
    }
    if (!scheduledAt) {
      setError(t("chat.scheduleSetTime"));
      return;
    }
    const at = new Date(scheduledAt);
    if (at.getTime() <= Date.now()) {
      setError(t("chat.scheduleInFuture"));
      return;
    }
    setSubmitting(true);
    const payload: Parameters<typeof scheduledApi.create>[1] = {
      content: text,
      scheduled_at: at.toISOString(),
      recurrence,
    };
    if (recurrence !== "none") {
      payload.recurrence_time = recurrenceTime;
      if (recurrence === "weekly") payload.recurrence_weekday = recurrenceWeekday;
    }
    scheduledApi
      .create(chatId, payload)
      .then(() => onSaved())
      .catch((err: { response?: { data?: { detail?: string; recurrence_time?: string[]; recurrence_weekday?: string[] } } }) => {
        const msg = err.response?.data?.detail || err.response?.data?.recurrence_time?.[0] || err.response?.data?.recurrence_weekday?.[0] || t("chat.scheduleSaveError");
        setError(msg);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <ModalViewportLayer onBackdropClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">{t("chat.scheduledMessageTitle")}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">&#10005;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelText")}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
              maxLength={MESSAGE_MAX_LENGTH}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[80px]"
              placeholder={t("chat.messagePlaceholder")}
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelDate")}</label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelTime")}</label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelRepeat")}</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as "none" | "daily" | "weekly")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="none">{t("chat.scheduleOnce")}</option>
              <option value="daily">{t("chat.scheduleEveryDay")}</option>
              <option value="weekly">{t("chat.scheduleWeekly")}</option>
            </select>
          </div>
          {recurrence !== "none" && (
            <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelTime")}</label>
              <input
                type="time"
                value={recurrenceTime}
                onChange={(e) => setRecurrenceTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            {recurrence === "weekly" && (
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelWeekday")}</label>
                <select
                  value={recurrenceWeekday}
                  onChange={(e) => setRecurrenceWeekday(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {weekdays.map((label, i) => (
                    <option key={i} value={i}>{label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {submitting ? t("chat.scheduleSaving") : t("chat.schedule")}
            </button>
          </div>
        </form>
      </div>
    </ModalViewportLayer>
  );
}
