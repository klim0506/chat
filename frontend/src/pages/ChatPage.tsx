import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, memo, Fragment } from "react";
import { createPortal } from "react-dom";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatsApi, messagesApi, filesApi, scheduledApi, paymentsApi, authApi } from "../api/client";
import type { Chat, ChatMember, Message, User, UserSearchResult, ScheduledMessage as ScheduledMessageType } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore } from "../store/preferences";
import { useMessagesStore, normalizeMessage as storeNormalizeMessage } from "../store/messages";
import { useOutboxStore } from "../store/outbox";
import { useNetworkStore } from "../store/network";
import { useChatListStore } from "../store/chatList";
import { getAvatarInitials } from "../lib/avatar-initials";
// import { compressImageForUpload } from "../lib/image-compression";
import { playSound } from "../lib/sounds";
import { AvatarEditorModal } from "../components/AvatarEditorModal";
import { AvatarCropConfirmModal } from "../components/AvatarCropConfirmModal";
import { FilePreviewModal } from "../components/FilePreviewModal";
import { OfflineBanner } from "../components/OfflineBanner";
import { ProgressiveImage } from "../components/ProgressiveImage";
import { WsManager, buildWsUrl } from "../lib/ws-manager";
import { db } from "../lib/db";
import { prepareEncryptedMessage } from "../lib/e2ee/prepare-message";
import { decryptFromDevice } from "../lib/e2ee/session-manager";
import * as e2eeKeyStorage from "../lib/e2ee/key-storage";
import { useCachedMediaUrl } from "../hooks/useCachedMediaUrl";
import { toSameOriginMediaUrl } from "../lib/media-url";
import { AnimatedReaction } from "../components/AnimatedReaction";
import { LottieSticker, getStickerAnimationUrl } from "../components/LottieSticker";
import { StickerGifPanel } from "../components/StickerGifPanel";
import { REACTIONS } from "../lib/reaction-animations";
import { switchLayout } from "../lib/layout-switcher";
import { useTranslation, formatLastSeenI18n, formatDateLabelI18n, formatMembersCount, getLocale, getWeekdays, t as tI18n } from "../lib/i18n";
// Фон по умолчанию для всех чатов (файл из public или алиас в vite.config)
import defaultChatBackground from "@default-chat-bg";

/** Эмодзи для реакций (из reaction-animations, совпадает с бэкендом) */
const REACTION_EMOJIS = REACTIONS.map((r) => r.emoji);

/** Максимальный размер файла при загрузке — 0,5 ГБ */
const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
const VIRTUALIZATION_THRESHOLD = 120;
const VIRTUAL_ROW_ESTIMATE = 92;
const VIRTUAL_OVERSCAN = 10;


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

/** Проверка, что две даты (ISO) относятся к одному дню в локальной временной зоне */
function isSameDay(isoA: string | undefined, isoB: string | undefined): boolean {
  if (!isoA || !isoB) return false;
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Форматирование даты для разделителей: «Сегодня», «Вчера» или «15 февраля [2025]» */
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

/** Сжатие изображения для экономии памяти (скрепка / нижняя зона). Пока отключено — храним в полном размере. */
async function compressImage(file: File): Promise<File> {
  // return compressImageForUpload(file, { maxDim: 2560, quality: 0.92 });
  return file;
}

/** Убирает Markdown-разметку для вставки в Word и т.п.: жирный, курсив, ссылки [текст](url)→текст, код `...`, заголовки #. */
function stripMarkdown(text: string): string {
  let s = text;
  // Ссылки [текст](url) → текст
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Инлайн-код `...`
  s = s.replace(/`([^`]*)`/g, "$1");
  // Жирный **...** или __...__
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  // Курсив *...* или _..._ (не в середине слова)
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");
  // Зачёркнутое ~~...~~
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // Заголовки в начале строки: # ## ### ...
  s = s.replace(/^#{1,6}\s+/gm, "");
  return s.trim();
}

/** Форматирование «был в сети» */
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
    (msg.sender as User)?.display_name ||
    (msg.sender as User)?.phone ||
    (msg as { sender_id?: string }).sender_id ||
    "?"
  );
}

/** Регулярка для упоминаний: @Имя или @Имя Фамилия (до пробела/конца/след. @) */
const MENTION_REGEX = /(@(?:[^\s@]+(?:\s+[^\s@]+)*?))(?=\s|$|@)/g;

/** Конвертация Markdown (подмножество: ** * ~~ [](url) [](copy)) в HTML для WYSIWYG-поля ввода */
function markdownToHtml(md: string): string {
  if (!md.trim()) return "";
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // [text](copy) или [text](copy:...) — копируемый при клике
  html = html.replace(/\[([^\]]*)\]\((copy(?::[^)]*)?)\)/g, '<span data-copy="true">$1</span>');
  // [text](url) — ссылка
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

/** Конвертация HTML из contenteditable обратно в Markdown для отправки */
function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\u00A0/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    const inner = Array.from(node.childNodes).map(walk).join("");
    if (tag === "BR") return "\n";
    if (tag === "STRONG" || tag === "B") return `**${inner}**`;
    if (tag === "EM" || tag === "I") return `*${inner}*`;
    if (tag === "S" || tag === "STRIKE") return `~~${inner}~~`;
    if (tag === "A") {
      const href = (el.getAttribute("href") || "").trim();
      if (href === "copy" || href.startsWith("copy:")) return `[${inner}](copy)`;
      return `[${inner}](${href})`;
    }
    if (tag === "SPAN" && el.getAttribute("data-copy") === "true") return `[${inner}](copy)`;
    return inner;
  }
  return walk(div).replace(/\n/g, "\n").trim();
}

/** Текущая позиция курсора (в символах) в contenteditable */
function getEditableCursorOffset(editable: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(editable, 0);
  return range.toString().length;
}

/** Поставить курсор в contenteditable на заданную позицию (в символах) */
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

/** Получить Range по символьным смещениям в contenteditable */
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

/** Разбивает текст на сегменты: обычный текст и упоминания @... */
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
 * Создаёт обработчики touch-событий для long-press на мобильных устройствах.
 * callback вызывается после удержания ≥ delay мс без перемещения пальца.
 * firedRef.current будет true, если long-press сработал (позволяет подавить onClick).
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

/** Рендер текста сообщения с поддержкой Markdown и упоминаний @... */
function MarkdownMessageContent({
  content,
  isMine,
  className = "",
  inline = false,
}: {
  content: string;
  isMine: boolean;
  className?: string;
  inline?: boolean;
}) {
  const baseCls = "text-slate-800";
  const segments = splitContentWithMentions(content);
  const Wrapper: React.ElementType = inline ? "span" : "div";
  return (
    <Wrapper className={`markdown-message ${baseCls} ${className}`}>
      {segments.map((seg, i) => {
        if (seg.type === "mention") {
          return (
            <span
              key={i}
              className={`inline font-medium ${isMine ? "text-blue-700" : "text-blue-600"}`}
              title={`Упоминание: ${seg.value.slice(1)}`}
            >
              {seg.value}
            </span>
          );
        }
        const mdContent = seg.value.replace(/\n/g, "  \n");
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
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
            {mdContent}
          </ReactMarkdown>
        );
      })}
    </Wrapper>
  );
}

/** Приводит сообщение из API/WS к единому виду (reactions, read_status и т.д.). */
function normalizeMessage(msg: Message & { read_status?: "delivered" | "read" | null; my_reaction?: string | null }): Message {
  let files = msg.files ?? [];
  if (!Array.isArray(files)) files = [];
  if (files.length === 0 && msg.file) files = [msg.file];
  // Оставляем только объекты с id (API мог вернуть сырые id или неполные данные)
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

/** Превью сообщения для списка чатов (совпадает с логикой бэкенда). */
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
  const text = (msg.content || "").trim();
  if (!text) return "(сообщение)";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

/** Видео с автовоспроизведением при появлении в зоне видимости (muted для обхода политики браузера). */
function InlineAutoplayVideo({ src, className = "" }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.isIntersecting) {
          el.muted = true;
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.25, rootMargin: "50px" }
    );
    io.observe(container);
    return () => io.disconnect();
  }, [src]);

  return (
    <div ref={containerRef} className="relative">
      <video
        ref={videoRef}
        src={src}
        className={className}
        preload="metadata"
        playsInline
        muted
        loop
        controls
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

export default function ChatPage({ chatId: propChatId, onBack, onChatUpdated, onChatLeft, onOpenDmWithUserId, onMessageSent, onNavigateToChat }: { chatId?: string; onBack?: () => void; onChatUpdated?: (chat: Chat) => void; onChatLeft?: (chatId: string) => void; onOpenDmWithUserId?: (userId: string) => void; onMessageSent?: (chatId: string, preview: string) => void; onNavigateToChat?: (chatId: string) => void } = {}) {
  const { chatId: paramChatId } = useParams<{ chatId: string }>();
  const chatId = propChatId || paramChatId;
  const token = useAuthStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.user);
  const myUserId = currentUser?.id || "";
  const textScale = usePreferencesStore((s) => s.messageTextScale);
  const language = usePreferencesStore((s) => s.language);
  const { t, lang } = useTranslation();

  const [chat, setChat] = useState<Chat | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const messages = useMessagesStore((s) => s.byChat[chatId ?? ""] ?? []);
  const storeUpsertMessage = useMessagesStore((s) => s.upsertMessage);
  const storeLoadMessages = useMessagesStore((s) => s.loadMessages);
  const storeLoadOlderMessages = useMessagesStore((s) => s.loadOlderMessages);
  const storeUpdateMessage = useMessagesStore((s) => s.updateMessage);
  const hasOlderMessages = useMessagesStore((s) => s.hasMoreByChat[chatId ?? ""] ?? true);
  const loadingOlder = useMessagesStore((s) => s.loadingOlderChats[chatId ?? ""] ?? false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  /** User ID to show in the info panel (profile view); null = show chat info */
  const [infoUserId, setInfoUserId] = useState<string | null>(null);
  const [usernameShake, setUsernameShake] = useState(false);
  const [mediaLinksFilesTab, setMediaLinksFilesTab] = useState<"media" | "links" | "files" | "participants">("media");
  const [copiedState, setCopiedState] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  /** Режим голоса: запись файла или AI-транскрипция в поле ввода. Переключается правым кликом по кнопке микрофона. */
  const [voiceInputMode, setVoiceInputMode] = useState<"record" | "ai">(() => {
    try {
      const v = localStorage.getItem("chat_voice_input_mode");
      return v === "ai" ? "ai" : "record";
    } catch {
      return "record";
    }
  });
  /** Идёт ли AI-распознавание речи (транскрипция в поле ввода). */
  const [aiListening, setAiListening] = useState(false);
  /** Контекстное меню правого клика по кнопке микрофона (переключение режима). */
  /** Текущие амплитуды для визуализации во время записи (32 полоски) */
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);
  /** Уровень громкости при записи (0..255) для индикатора */
  const [voiceLevel, setVoiceLevel] = useState(0);
  /** Онлайн-статусы пользователей: userId → { is_online, last_seen_display } */
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
  const stickerGifPickerRef = useRef<HTMLDivElement>(null);
  /** Редактирование сообщения в поле ввода (для сообщений только из эмодзи) */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [formatMenuPos, setFormatMenuPos] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  /** Сообщение, на которое отвечаем (reply bar над input) */
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  /** Сообщение для пересылки (открывает ForwardModal) */
  const [forwardModalMessage, setForwardModalMessage] = useState<Message | null>(null);
  /** Telegram-style pinned messages: index currently shown */
  const [pinnedIndex, setPinnedIndex] = useState(0);
  /** Просмотр одного изображения в модалке поверх чата */
  const [singleImagePreview, setSingleImagePreview] = useState<{ url: string; fileName?: string } | null>(null);
  /** Файлы для предпросмотра перед отправкой (модалка). asFileOnly: отправлять всё как file (drop в верхнюю зону) */
  const [pendingFilesForPreview, setPendingFilesForPreview] = useState<File[] | null>(null);
  const [pendingFilesAsFileOnly, setPendingFilesAsFileOnly] = useState(false);
  /** Пicker тегов @: открыт ли, позиция @ в input, выбранный индекс */
  const [mentionPicker, setMentionPicker] = useState<{ open: boolean; start: number; selectedIndex: number }>({ open: false, start: 0, selectedIndex: 0 });
  /** Непрочитанные при заходе в чат: id сообщений (низ которых ещё не попал в зону видимости) */
  const [initialUnreadIds, setInitialUnreadIds] = useState<string[]>([]);
  /** Id сообщений, у которых низ уже был в зоне видимости */
  const [seenBottomIds, setSeenBottomIds] = useState<Set<string>>(new Set());
  /** Линия «Непрочитанные» скрыта после того, как все initialUnreadIds прочитаны и вызван markRead */
  const [unreadLineDismissed, setUnreadLineDismissed] = useState(false);
  const sentinelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputEditableRef = useRef<HTMLDivElement>(null);
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

  /** Установить и markdown-состояние, и отображение в contenteditable (при программной смене контента) */
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

  /** Применить формат через execCommand в contenteditable (сохранённая выделение в savedFormatRangeRef) */
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

  /** Форматирование по горячим клавишам в contenteditable (Ctrl+B, Ctrl+I и т.д.). */
  const applyFormatShortcut = useCallback((cmd: string, value?: string) => {
    const el = inputEditableRef.current;
    if (!el) return;
    pushUndoState(htmlToMarkdown(el.innerHTML));
    if (value != null) document.execCommand(cmd, false, value);
    else document.execCommand(cmd, false);
    setInput(htmlToMarkdown(el.innerHTML));
    setTimeout(() => el.focus(), 0);
  }, [pushUndoState]);

  /** Переключение раскладки EN↔RU: для выделенного текста или всего поля ввода. */
  const handleSwitchLayout = useCallback(() => {
    const el = inputEditableRef.current;
    if (!el) return;
    const sel = window.getSelection();
    // Если есть выделение внутри поля — конвертируем только выделенный текст
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const selectedText = range.toString();
      if (selectedText) {
        pushUndoState(htmlToMarkdown(el.innerHTML));
        const converted = switchLayout(selectedText);
        range.deleteContents();
        range.insertNode(document.createTextNode(converted));
        // Восстановим выделение на конвертированный текст
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(range.startContainer);
        sel.addRange(newRange);
        setInput(htmlToMarkdown(el.innerHTML));
        return;
      }
    }
    // Иначе — конвертируем всё содержимое
    const md = htmlToMarkdown(el.innerHTML);
    if (!md.trim()) return;
    pushUndoState(md);
    const converted = switchLayout(md);
    setInputAndEditable(converted);
    setTimeout(() => el.focus(), 0);
  }, [pushUndoState, setInputAndEditable]);

  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState("");

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
  const [deleteError, setDeleteError] = useState("");
  const [approveRejectLoading, setApproveRejectLoading] = useState<string | null>(null);
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [inviteSearchResults, setInviteSearchResults] = useState<UserSearchResult[]>([]);
  const [inviteSearchLoading, setInviteSearchLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const infoMenuRef = useRef<HTMLDivElement>(null);
  const [showAvatarFullscreen, setShowAvatarFullscreen] = useState<string | null>(null);

  /* Video recording state */
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoRecordingTime, setVideoRecordingTime] = useState(0);

  /* Drag-and-drop state */
  const [dragOver, setDragOver] = useState(false);
  const [dropZone, setDropZone] = useState<"top" | "bottom" | null>(null);
  const dragCounterRef = useRef(0);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD_PX = 80;
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const rowHeightsRef = useRef<Map<string, number>>(new Map());
  const [virtualMeasureTick, setVirtualMeasureTick] = useState(0);
  const [messagesScrollTop, setMessagesScrollTop] = useState(0);
  const [messagesViewportHeight, setMessagesViewportHeight] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const notifWsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      setShowInfo(false); setInfoUserId(null);
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
    setShowInfo(false); setInfoUserId(null);
  }, [messageIndexById, virtualState.offsets, flashHighlightMessage]);

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

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  /* ---------- Load older messages on scroll up (pagination) ---------- */
  useEffect(() => {
    if (!chatId) return;
    const sentinel = loadMoreSentinelRef.current;
    const scrollRoot = messagesScrollRef.current;
    if (!sentinel || !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasOlderMessages && !loadingOlder) {
          // Save scroll position before prepending older messages
          const prevScrollHeight = scrollRoot.scrollHeight;
          storeLoadOlderMessages(chatId).then((prepended) => {
            if (prepended.length > 0) {
              // Restore scroll position after DOM update
              requestAnimationFrame(() => {
                const newScrollHeight = scrollRoot.scrollHeight;
                scrollRoot.scrollTop += newScrollHeight - prevScrollHeight;
              });
            }
          });
        }
      },
      { root: scrollRoot, threshold: 0, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [chatId, hasOlderMessages, loadingOlder, storeLoadOlderMessages]);

  /* ---------- Send text (after scrollToBottom so it can be used in deps) ---------- */
  const sendTextMessage = useCallback(async (text: string) => {
    if (!chatId || !text.trim()) return;
    const replyId = replyToMessage?.id || undefined;
    const trimmed = text.trim();

    const doSendPlain = () => {
      const payload = { type: "chat.message" as const, msg_type: "text", content: trimmed, ...(replyId ? { reply_to: replyId } : {}) };
      if (chatWsRef.current?.isConnected()) {
        chatWsRef.current.send(payload);
        playSound("send");
      } else if (!useNetworkStore.getState().isOnline) {
        useOutboxStore.getState().enqueue({ chatId, msgType: "text", content: trimmed });
        scrollToBottom();
      } else {
        messagesApi.create(chatId, { msg_type: "text", content: trimmed, ...(replyId ? { reply_to_id: replyId } : {}) }).then((res) => {
          storeUpsertMessage(chatId, storeNormalizeMessage(res.data));
          scrollToBottom();
          onMessageSent?.(chatId, formatMessagePreview(res.data, lang));
          playSound("send");
        });
      }
      setInput("");
      setReplyToMessage(null);
      if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
      resetUndoStack();
    };

    if (chat?.is_personal && chat.other_member) {
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
            playSound("send");
          } else if (!useNetworkStore.getState().isOnline) {
            useOutboxStore.getState().enqueue({ chatId, msgType: "text", content: trimmed });
            scrollToBottom();
          } else {
            messagesApi.create(chatId, {
              msg_type: "text",
              content: encPayload.content,
              is_encrypted: true,
              sender_device_id: encPayload.sender_device_id,
              encrypted_keys: encPayload.encrypted_keys,
              ...(replyId ? { reply_to_id: replyId } : {}),
            }).then((res) => {
              // Replace ciphertext with cached plaintext for display
              const msgData = { ...res.data, content: trimmed };
              storeUpsertMessage(chatId, storeNormalizeMessage(msgData));
              scrollToBottom();
              onMessageSent?.(chatId, formatMessagePreview({ content: trimmed }, lang));
              playSound("send");
            });
          }
          setInput("");
          setReplyToMessage(null);
          if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
          resetUndoStack();
          return;
        }
      } catch {
        /* fall back to plain */
      }
    }
    doSendPlain();
  }, [chatId, chat, replyToMessage, resetUndoStack, scrollToBottom, onMessageSent, storeUpsertMessage]);

  const handleSelectGif = useCallback((url: string) => {
    if (!chatId || !url) return;
    setShowStickerGifPanel(false);
    const replyId = replyToMessage?.id;
    if (chatWsRef.current?.isConnected()) {
      chatWsRef.current.send({ type: "chat.message" as const, msg_type: "gif", content: url, ...(replyId ? { reply_to: replyId } : {}) });
      playSound("send");
    } else if (!useNetworkStore.getState().isOnline) {
      useOutboxStore.getState().enqueue({ chatId, msgType: "gif", content: url });
      scrollToBottom();
    } else {
      messagesApi.create(chatId, { msg_type: "gif", content: url, ...(replyId ? { reply_to_id: replyId } : {}) }).then((res) => {
        storeUpsertMessage(chatId, storeNormalizeMessage(res.data));
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(res.data, lang));
        playSound("send");
      });
    }
    setReplyToMessage(null);
  }, [chatId, replyToMessage, scrollToBottom, onMessageSent, storeUpsertMessage]);

  const handleSelectSticker = useCallback((path: string) => {
    if (!chatId || !path) return;
    setShowStickerGifPanel(false);
    const replyId = replyToMessage?.id;
    if (chatWsRef.current?.isConnected()) {
      chatWsRef.current.send({ type: "chat.message" as const, msg_type: "sticker", content: path, ...(replyId ? { reply_to: replyId } : {}) });
    } else if (!useNetworkStore.getState().isOnline) {
      useOutboxStore.getState().enqueue({ chatId, msgType: "sticker", content: path });
      scrollToBottom();
    } else {
      messagesApi.create(chatId, { msg_type: "sticker", content: path, ...(replyId ? { reply_to_id: replyId } : {}) }).then((res) => {
        storeUpsertMessage(chatId, storeNormalizeMessage(res.data));
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(res.data, lang));
        playSound("send");
      });
    }
    setReplyToMessage(null);
  }, [chatId, replyToMessage, scrollToBottom, onMessageSent, storeUpsertMessage]);

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

  const getInputMarkdown = useCallback(() =>
    inputEditableRef.current ? htmlToMarkdown(inputEditableRef.current.innerHTML) : input, [input]);

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = getInputMarkdown();
      sendTextMessage(text);
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
    // Ctrl+T — переключить раскладку EN↔RU
    if (ctrl && e.key === "t") {
      e.preventDefault();
      handleSwitchLayout();
      return;
    }
  }, [getInputMarkdown, sendTextMessage, applyFormatShortcut, setInputAndEditable, handleSwitchLayout, mentionPicker, mentionFiltered, insertMention]);

  /* ---------- Request notification permission on mount ---------- */
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  /* ---------- Автоподстройка высоты поля ввода: 1 строка → до 8 строк, далее внутренний скролл ---------- */
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
    if (!chatId || !token) return;
    setLoading(true);
    const chatP = chatsApi.get(chatId).then((res) => {
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
    const msgsP = storeLoadMessages(chatId);

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
          storeUpsertMessage(chatId, { ...msg, content: decrypted });
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

    chatsApi.members(chatId).then((res) => {
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
  }, [chatId, token, scrollToBottomInstant]);

  const refreshChat = useCallback(() => {
    if (!chatId) return;
    chatsApi.get(chatId).then((res) => setChat(res.data));
  }, [chatId]);

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

  useEffect(() => {
    if (!inviteSearchQuery.trim()) {
      setInviteSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      setInviteSearchLoading(true);
      authApi
        .searchUsers(inviteSearchQuery)
        .then((res) => setInviteSearchResults(res.data.results || []))
        .catch(() => setInviteSearchResults([]))
        .finally(() => setInviteSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [inviteSearchQuery]);

  /* ---------- Зафиксировать список непрочитанных при первом наличии чата и сообщений ---------- */
  useEffect(() => {
    if (!chat || messages.length === 0) return;
    const n = chat.unread_count ?? 0;
    if (n > 0 && initialUnreadIds.length === 0) {
      setInitialUnreadIds(messages.slice(-n).map((m) => m.id));
    }
  }, [chat, messages, chat?.unread_count, initialUnreadIds.length]);

  /* ---------- Intersection Observer: низ сообщения в зоне видимости = прочитано ---------- */
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

  /* ---------- Все непрочитанные прочитаны (низ в зоне видимости) → markRead и скрыть линию ---------- */
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
      if (infoMenuRef.current && !infoMenuRef.current.contains(e.target as Node)) {
        setShowInfoMenu(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showInfoMenu]);

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
    if (!chatId || !token) return;
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
      let raw = d.message;
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
      const atBottom = isScrolledToBottom();
      storeUpsertMessage(chatId, msg);
      if (isMine) onMessageSent?.(chatId, formatMessagePreview(raw as unknown as Message, lang));
      if (isMine || atBottom) setTimeout(scrollToBottom, 80);
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
      let raw = d.message;
      if (raw.is_deleted) {
        storeUpdateMessageRef.current(chatId, raw.id as string, { is_deleted: true });
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
      }
    });

    mgr.on("chat.typing", (data: unknown) => {
      const d = data as { display_name?: string; user_id?: string };
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
  /** Отправка одного файла (аудио, видео и т.п.) */
  const sendFileMessage = async (file: File, msgTypeOverride?: string) => {
    if (!chatId) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showFileTooBig(file.name);
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const uploadRes = await filesApi.upload(file, chatId);
      const fileId = uploadRes.data.id;
      // Бэкенд принимает только: text, file, audio, video, video_circle, emoji (нет "image")
      const msgType = msgTypeOverride ?? (
        file.type.startsWith("image/") ? "file"
        : file.type.startsWith("audio/") ? "audio"
        : file.type.startsWith("video/") ? "video"
        : "file"
      );
      const msgRes = await messagesApi.create(chatId, { msg_type: msgType, content: file.name, file_id: fileId });
      if (msgRes?.data?.id) {
        storeUpsertMessage(chatId, storeNormalizeMessage(msgRes.data));
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(msgRes.data, lang));
        playSound("send");
      } else {
        setUploadError(t("chat.serverBadResponse"));
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadError");
      setUploadError(msg);
      setTimeout(() => setUploadError(""), 4000);
    } finally {
      setUploading(false);
    }
  };

  /** Отправка нескольких изображений как одно сообщение (плитка) */
  const sendMultiImageMessage = async (imageFiles: File[]) => {
    if (!chatId || imageFiles.length === 0) return;
    const tooBig = imageFiles.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      // Загружаем все файлы параллельно
      const uploadResults = await Promise.all(
        imageFiles.map((f) => filesApi.upload(f, chatId))
      );
      const fileIds = uploadResults.map((r) => r.data.id);
      const names = imageFiles.map((f) => f.name).join(", ");
      const msgRes = await messagesApi.create(chatId, {
        msg_type: "file",
        content: names,
        file_ids: fileIds,
      });
      if (msgRes?.data?.id) {
        storeUpsertMessage(chatId, storeNormalizeMessage(msgRes.data));
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(msgRes.data, lang));
        playSound("send");
      } else {
        setUploadError(t("chat.serverBadResponse"));
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadErrorMultiple");
      setUploadError(msg);
      setTimeout(() => setUploadError(""), 4000);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = getInputMarkdown().trim();
    if (editingMessageId && chatId) {
      if (text) {
        messagesApi.update(chatId, editingMessageId, { content: text }).then((res) => {
          storeUpsertMessage(chatId, storeNormalizeMessage(res.data));
          setEditingMessageId(null);
          setInput("");
          if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
        });
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

  /** Отправка файлов после подтверждения в модалке предпросмотра */
  const handleFilesPreviewConfirm = async (files: File[], asFileOnly: boolean) => {
    setPendingFilesForPreview(null);
    if (files.length === 0) return;
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (tooBig) {
      showFileTooBig(tooBig.name);
      return;
    }
    if (asFileOnly) {
      files.forEach((f) => sendFileMessage(f, "file"));
      return;
    }
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    const others = files.filter((f) => !f.type.startsWith("image/") && !f.type.startsWith("video/"));
    if (images.length > 1) {
      const compressed = await Promise.all(images.map((f) => compressImage(f)));
      sendMultiImageMessage(compressed);
    } else if (images.length === 1 && others.length === 0 && videos.length === 0) {
      const one = await compressImage(images[0]);
      sendFileMessage(one);
    } else if (images.length === 1) {
      const one = await compressImage(images[0]);
      sendFileMessage(one);
    }
    videos.forEach((f) => sendFileMessage(f));
    others.forEach((f) => sendFileMessage(f));
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
    setPendingFilesAsFileOnly(false);
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

  /** Paste: обработать вставку изображений из буфера, остальное — по умолчанию */
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

  /* ---------- Expand chat (50 звёзд → 100 чел., 100 звёзд → 1000 чел.) ---------- */
  const handleExpandChat = async (targetMaxMembers: 100 | 1000) => {
    if (!chatId || !chat) return;
    setExpandLoading(true);
    setExpandError("");
    try {
      const { data } = await paymentsApi.expandChat(chatId, targetMaxMembers);
      if (data.ok) {
        setChat({
          ...chat,
          is_expanded: true,
          expanded_until: data.expanded_until,
          effective_max_members: data.effective_max_members ?? targetMaxMembers,
        });
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setExpandError(detail || t("chat.expandError"));
    } finally {
      setExpandLoading(false);
    }
  };

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

  const handleLeaveChat = () => {
    if (!chatId || !window.confirm(t("chat.leaveChat"))) return;
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

  const handleDeleteChat = () => {
    if (!chatId || !window.confirm(t("chat.deleteChat"))) return;
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

  /* ---------- Voice recording: визуализация + сбор амплитуд ---------- */
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

        setUploading(true);
        setUploadError("");
        try {
          const uploadRes = await filesApi.upload(file, chatId ?? undefined);
          const fileId = uploadRes.data.id;
          const msgRes = await messagesApi.create(chatId!, {
            msg_type: "audio",
            content: file.name,
            file_id: fileId,
            waveform: waveform.length > 0 ? waveform : undefined,
          });
          if (msgRes?.data?.id) {
            storeUpsertMessage(chatId!, storeNormalizeMessage(msgRes.data));
            scrollToBottom();
            onMessageSent?.(chatId!, formatMessagePreview(msgRes.data, lang));
            playSound("send");
          } else {
            setUploadError(t("chat.serverBadResponse"));
            setTimeout(() => setUploadError(""), 4000);
          }
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("chat.uploadError");
          setUploadError(msg);
          setTimeout(() => setUploadError(""), 4000);
        } finally {
          setUploading(false);
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

  /* ---------- AI voice input: распознавание речи в текст (Web Speech API) ---------- */
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

  const toggleVoiceMode = useCallback(() => {
    setVoiceInputMode((prev) => {
      const next = prev === "ai" ? "record" : "ai";
      try {
        localStorage.setItem("chat_voice_input_mode", next);
      } catch { /* ignore */ }
      return next;
    });
    if (recording) stopRecording();
    if (aiListening) stopAiListening();
  }, [recording, aiListening, stopRecording, stopAiListening]);

  /* ── Long-press handlers (mobile) for send / voice / input ── */
  const lpSendHandlers = useMemo(() => makeLongPressHandlers(lpSendRef, lpSendFiredRef, (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setScheduleMenuPos({ x: rect.left, y: rect.top });
  }), []);

  const lpVoiceHandlers = useMemo(() => makeLongPressHandlers(lpVoiceRef, lpVoiceFiredRef, () => {
    toggleVoiceMode();
  }), [toggleVoiceMode]);

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
      const isCircle = mode === "video_circle";
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
        stream.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
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

  /* ---------- Loading ---------- */
  if (loading || !chat) return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-50 w-full">
      <p className="text-slate-500">{loading ? t("common.loading") : t("chat.loadError")}</p>
    </div>
  );

  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "pending");
  const handleCopy = () => {
    if (!chat.invite_link) return;
    copyToClipboard(normalizeInviteLink(chat.invite_link)).then(() => { setCopiedState(true); setTimeout(() => setCopiedState(false), 2000); });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-slate-50 overflow-hidden">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
      {/* Модалка просмотра одного изображения — затемнение + картинка по центру */}
      {singleImagePreview && createPortal(
        <SingleImageModal
          url={singleImagePreview.url}
          fileName={singleImagePreview.fileName}
          onClose={() => setSingleImagePreview(null)}
        />,
        document.body,
      )}
      {/* Forward modal */}
      {forwardModalMessage && chatId && (
        <ForwardModal
          message={forwardModalMessage}
          sourceChatId={chatId}
          onClose={() => setForwardModalMessage(null)}
          onForwardComplete={(targetIds) => { if (targetIds[0] && onNavigateToChat) onNavigateToChat(targetIds[0]); }}
        />
      )}
      {pendingFilesForPreview && (
        <FilePreviewModal
          files={pendingFilesForPreview}
          onConfirm={(files) => handleFilesPreviewConfirm(files, pendingFilesAsFileOnly)}
          onCancel={() => { setPendingFilesForPreview(null); }}
        />
      )}
      <div
        ref={chatAreaRef}
        className="flex flex-col flex-1 min-w-0 min-h-0 relative overflow-hidden"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onTouchStart={(e) => {
          if (e.touches.length !== 1 || !onBack) return;
          swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          if (e.changedTouches.length !== 1 || !onBack || !swipeStartRef.current) return;
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          const endX = e.changedTouches[0].clientX;
          const endY = e.changedTouches[0].clientY;
          const dx = endX - start.x;
          const dy = endY - start.y;
          if (dx > SWIPE_THRESHOLD_PX && Math.abs(dy) < 120) onBack();
        }}
        onTouchCancel={() => { swipeStartRef.current = null; }}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-40 flex flex-col pointer-events-none">
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

        {/* Header */}
      <header className="border-b bg-white px-4 py-2 flex items-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden shrink-0 p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title={t("chat.toChatList")}
              aria-label={t("chat.toChatList")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <button type="button" onClick={() => { setInfoUserId(null); setShowInfo(!showInfo); }} className="flex-1 text-left hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-colors min-w-0">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {chat.is_favorites ? (
                  <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                ) : (chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                  <img src={toSameOriginMediaUrl(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!)} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                    {chat.is_personal && chat.other_member
                      ? getAvatarInitials(chat.other_member.display_name || chat.other_member.phone)
                      : getAvatarInitials(chat.title || "Ч")}
                  </div>
                )}
                {chat.is_personal && chat.other_member && onlineStatus[chat.other_member.id]?.is_online && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                )}
              </div>
          <h1 className="font-semibold text-slate-800 flex items-center gap-1.5">
                {chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}
                {chat.is_personal && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-label={t("chat.e2ee")}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
              </h1>
              {isMuted && (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-label={t("dashboard.muted")}>
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              )}
        </div>
            <p className="text-sm text-slate-500">
              {chat.is_personal && chat.other_member ? (
                typing ? (
                  <span className="text-slate-400 italic">{typing} печатает…</span>
                ) : (
                  <>
                    <span>{t("chat.personal")}</span>
                    {onlineStatus[chat.other_member.id]?.is_online ? (
                      <span className="text-green-500 ml-1">· {t("chat.online")}</span>
                    ) : onlineStatus[chat.other_member.id]?.last_seen_display ? (
                      <span className="ml-1">· {formatLastSeen(onlineStatus[chat.other_member.id].last_seen_display, lang)}</span>
                    ) : null}
                  </>
                )
              ) : (
                (() => {
                  const onlineCount = members.filter((m) => onlineStatus[m.user.id]?.is_online && m.user.id !== myUserId).length + (onlineStatus[myUserId]?.is_online ? 1 : 0);
                  const membersLabel = formatMembersCount(chat.members_count, lang);
                  const onlineLabel = onlineCount > 0 ? ` · ${onlineCount} ${t("chat.online")}` : "";
                  const typeLabel = chat.chat_type != null ? ` · ${chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}` : "";
                  return membersLabel + onlineLabel + typeLabel;
                })()
              )}
            </p>
          </button>
          <button type="button" onClick={() => { setInfoUserId(null); setShowInfo(!showInfo); }} className={`p-2 rounded-lg transition-colors ${showInfo ? "bg-blue-100 text-blue-600" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`} title={t("chat.chatInfo")}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
      </header>

        {/* ── Unified pinned messages bar (always visible, not scrollable) ── */}
        {(() => {
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
          const pinSender = (current.message.sender as User)?.display_name || (current.message.sender as User)?.phone || "";
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
            <div className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm z-20">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-slate-50 transition-colors min-h-[38px]"
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

        {/* Messages — фон и размывающая подложка в одном неподвижном слое, контент скроллится поверх */}
        <div className="relative flex-1 min-h-0 flex flex-col min-w-0">
          <div
            className="absolute inset-0 pointer-events-none z-0"
            aria-hidden
            style={{
              backgroundImage: `url(${chat?.background_url ?? defaultChatBackground})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-white/30 pointer-events-none z-0" aria-hidden />
          <div
            ref={messagesScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 pb-5 sm:pt-3 sm:px-3 sm:pb-12 flex flex-col scrollbar-hide relative z-10"
            onContextMenu={(e) => e.preventDefault()}
            onScroll={handleMessagesScroll}
          >
          {/* Плавающая дата при скролле (sticky date header) */}
          {messages.length > 0 && (() => {
            const showSticky = messagesScrollTop > 56;
            const firstVisible = virtualState.enabled ? messages[virtualState.start] : messages[0];
            const stickyLabel = showSticky && firstVisible ? formatDateLabel(firstVisible.created_at, language) : null;
            return stickyLabel ? (
              <div className="sticky top-0 z-20 flex justify-center pt-2 pb-1 -mt-2 pointer-events-none" aria-hidden>
                <span className="px-3 py-1.5 rounded-full bg-slate-700/95 text-white text-xs font-medium shadow-lg backdrop-blur">
                  {stickyLabel}
                </span>
              </div>
            ) : null;
          })()}
          <div className="flex flex-col space-y-0 min-h-0">
          {/* E2EE banner для личного чата */}
          {chat?.is_personal && chat?.other_member && (
            <div className="shrink-0 flex justify-center py-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200 text-xs text-green-700">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>Сообщения защищены сквозным шифрованием</span>
              </div>
            </div>
          )}
          {/* Заявки на вступление — как обычное сообщение в ленте, кнопки в стиле Telegram */}
          {!chat?.is_personal && pendingMembers.length > 0 && chat?.owner?.id === myUserId && (
            <div className="shrink-0 flex justify-center my-3">
              <div className="inline-block max-w-[85%] rounded-2xl bg-slate-100/90 border border-slate-200 px-4 py-3 shadow-sm">
                <p className="text-xs font-medium text-slate-500 mb-3">Заявки на вступление ({pendingMembers.length})</p>
                <ul className="space-y-3">
                  {pendingMembers.map((m) => (
                    <li key={m.id} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600 shrink-0">
                        {getAvatarInitials(m.user.display_name || m.user.phone)}
                      </div>
                      <span className="text-sm text-slate-800 truncate flex-1 min-w-0">{m.user.display_name || m.user.phone}</span>
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
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-h-[120px]">
              <div className="text-center text-sm max-w-xs rounded-xl bg-white/70 backdrop-blur-sm border border-slate-200/60 shadow-sm px-6 py-5">
                {chat?.is_favorites ? (
                  <>
                    <p className="font-medium text-slate-700 mb-2">⭐ {t("chat.favoritesTitle")}</p>
                    <p className="text-slate-500 leading-relaxed">{t("chat.favoritesHint")}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-slate-600 mb-1">{t("chat.emptyChat")}</p>
                    <p className="text-slate-500">{t("chat.emptyChatHint")}</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            (() => {
              const showUnreadLine = !unreadLineDismissed && initialUnreadIds.length > 0;
              const firstUnreadIndex = showUnreadLine
                ? messages.findIndex((m) => initialUnreadIds.includes(m.id))
                : -1;
              const start = virtualState.enabled ? virtualState.start : 0;
              const end = virtualState.enabled ? virtualState.end : messages.length;
              const visibleMessages = messages.slice(start, end);
              const GROUP_TIME_MS = 5 * 60 * 1000;
              return (
                <Fragment>
                  {/* Sentinel for loading older messages on scroll up */}
                  <div ref={loadMoreSentinelRef} className="shrink-0" aria-hidden>
                    {loadingOlder && (
                      <div className="flex justify-center py-3">
                        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
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
                    const nextMsg = messages[i + 1];
                    const sameSender = nextMsg && getSenderId(msg) === getSenderId(nextMsg);
                    const timeGap = nextMsg
                      ? new Date(nextMsg.created_at).getTime() - new Date(msg.created_at).getTime()
                      : Infinity;
                    const showAvatar = !nextMsg || !sameSender || timeGap >= GROUP_TIME_MS;
                    const prevMsg = messages[i - 1];
                    const isLastInGroup = showAvatar && !!prevMsg && getSenderId(prevMsg) === getSenderId(msg);
                    const isFirstInGroup = !prevMsg || getSenderId(prevMsg) !== getSenderId(msg) ||
                      new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() >= GROUP_TIME_MS;
                    const showDateDivider = !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);
                    return (
                      <div
                        key={msg.id}
                        ref={(el) => {
                          if (!el) return;
                          const nextHeight = el.offsetHeight;
                          const prevHeight = rowHeightsRef.current.get(msg.id);
                          if (prevHeight == null || Math.abs(prevHeight - nextHeight) > 2) {
                            rowHeightsRef.current.set(msg.id, nextHeight);
                            setVirtualMeasureTick((v) => v + 1);
                          }
                        }}
                        className={isFirstInGroup ? "mt-1" : "mt-0"}
                      >
                        {showDateDivider && <DateDivider date={msg.created_at} lang={language} />}
                        {showUnreadLine && i === firstUnreadIndex && (
                          <div data-unread-line className="flex items-center gap-3 py-1.5">
                            <span className="flex-1 h-px bg-slate-300" aria-hidden />
                            <span className="text-xs font-medium text-slate-500 shrink-0">Непрочитанные сообщения</span>
                            <span className="flex-1 h-px bg-slate-300" aria-hidden />
                          </div>
                        )}
                        <MessageBubble
                          message={msg}
                          isMine={getSenderId(msg) === myUserId}
                          showAvatar={showAvatar}
                          isLastInGroup={isLastInGroup}
                          chatId={chatId!}
                          textScale={textScale}
                          onMessageUpdated={(updated) =>
                            storeUpsertMessage(chatId!, storeNormalizeMessage(updated))
                          }
                          onMessageDeleted={(id) => storeUpdateMessage(chatId!, id, { is_deleted: true })}
                          onStartEditInInput={(id, content) => { setEditingMessageId(id); setInputAndEditable((content || "").trim()); }}
                          onImageClick={(url, fileName) => setSingleImagePreview({ url, fileName })}
                          canPinForAll={!!(chat && (chat.owner?.id === myUserId || members.some((m) => m.user.id === myUserId && m.role === "admin")))}
                          pinnedForAllIds={chat?.pinned_messages?.map((m) => m.id) ?? (chat?.pinned_message ? [chat.pinned_message.id] : [])}
                          maxPins={chat?.max_pins ?? 1}
                          myPinnedIds={chat?.my_pinned_messages?.map((m) => m.id) ?? []}
                          onPinChange={refreshChat}
                          onReply={(m) => { setReplyToMessage(m); inputEditableRef.current?.focus(); }}
                          onForward={(m) => setForwardModalMessage(m)}
                          onAvatarClick={(userId?: string) => { setInfoUserId(userId ?? null); setShowInfo(true); }}
                        />
                        <div
                          ref={(el) => {
                            if (el) sentinelRefs.current.set(msg.id, el);
                            else sentinelRefs.current.delete(msg.id);
                          }}
                          data-message-id={msg.id}
                          className="h-px w-full shrink-0"
                          aria-hidden
                        />
                      </div>
                    );
                  })}
                  {virtualState.enabled && <div style={{ height: virtualState.bottomPadding }} aria-hidden />}
                </Fragment>
              );
            })()
          )}
        <div ref={bottomRef} />
          </div>
        </div>
      {showScrollToBottom && (
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
        {uploadError && <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-600 text-sm">{uploadError}</div>}

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
                <button type="button" onClick={stopVideoRecording} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>
                  Отправить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Input bar — правый клик: запланировать сообщение */}
        {recording ? (
          <div className="border-t bg-white p-2 flex gap-2 items-center">
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
                  <span className="text-[10px] text-slate-500 tabular-nums">{Math.round((voiceLevel / 255) * 100)}%</span>
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
            <button type="button" onClick={stopRecording} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>
              Отправить
            </button>
          </div>
        ) : (
          <div className="relative border-t bg-white">
            {editingMessageId && (
              <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between bg-amber-50/80">
                <span className="text-xs font-medium text-amber-800">Редактирование сообщения</span>
                <button type="button" onClick={cancelEditMessage} className="text-xs text-amber-700 hover:text-amber-900 font-medium">Отмена</button>
              </div>
            )}
            {aiListening && (
              <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between bg-blue-50/80">
                <span className="text-xs font-medium text-blue-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  AI-голосовой ввод — речь переводится в текст в поле ниже
                </span>
                <button type="button" onClick={stopAiListening} className="text-xs text-blue-700 hover:text-blue-900 font-medium">Остановить</button>
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
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-l-[3px] border-blue-400 mx-2 mt-1 rounded-r-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-blue-600 truncate">
                    {(replyToMessage.sender as User)?.display_name || (replyToMessage.sender as User)?.phone || ""}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {replyToMessage.msg_type !== "text" && replyToMessage.msg_type !== "emoji"
                      ? "(файл)"
                      : (replyToMessage.content || "").trim().slice(0, 80)}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-600 p-0.5"
                  onClick={() => setReplyToMessage(null)}
                  title={t("chat.cancelReply")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="p-1.5 sm:p-2 flex gap-1.5 sm:gap-2 items-end">
              <label className="cursor-pointer text-slate-500 hover:text-slate-700 p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 transition-colors" title={t("chat.attachFile")}>
                <input type="file" className="hidden" onChange={handleFile} disabled={uploading} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" multiple />
                {uploading ? (
                  <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                )}
              </label>
              <button type="button" onClick={() => setShowStickerGifPanel((p) => !p)} className={`text-slate-500 hover:text-slate-700 p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 transition-colors ${showStickerGifPanel ? "bg-slate-100" : ""}`} title={t("chat.stickersAndGif")} disabled={uploading}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              {showStickerGifPanel && (
                <div ref={stickerGifPickerRef} className="absolute bottom-full right-2 left-2 sm:left-auto sm:right-2 z-50 mb-1">
                  <StickerGifPanel onSelectEmoji={handleEmojiSelect} onSelectGif={handleSelectGif} onSelectSticker={handleSelectSticker} />
                </div>
              )}
              <div
                ref={inputEditableRef}
                contentEditable={!uploading}
                suppressContentEditableWarning
                data-placeholder={t("chat.messagePlaceholder")}
                onInput={(e) => {
                  const el = e.currentTarget;
                  const html = el.innerHTML;
                  const md = htmlToMarkdown(html);
                  setInput(md);
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
                      return;
                    }
                  }
                  setMentionPicker((p) => (p.open ? { ...p, open: false } : p));
                }}
                onBlur={() => {
                  setTimeout(() => setMentionPicker((p) => (p.open ? { ...p, open: false } : p)), 150);
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
                className="flex-1 min-h-[2.5rem] max-h-[11rem] overflow-y-auto resize-none border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 scrollbar-hide empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
                style={{ height: "40px" }}
              />
            {/* Video circle button */}
            <button type="button" onClick={() => startVideoRecording("video_circle")} className="text-slate-500 hover:text-purple-500 p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 transition-colors" title={t("chat.videoCircle")} disabled={uploading}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
            </button>
            {/* Голос: запись файла или AI-транскрипция. Правый клик — переключить режим. */}
            <button
              type="button"
              onClick={() => { if (!lpVoiceFiredRef.current) toggleVoiceInput(); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleVoiceMode();
              }}
              {...lpVoiceHandlers}
              className={`p-1.5 sm:p-2 rounded-lg transition-colors ${voiceInputMode === "ai" ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50" : "text-slate-500 hover:text-red-500 hover:bg-slate-100"} ${aiListening ? "bg-blue-100 text-blue-700" : ""}`}
              title={voiceInputMode === "ai" ? (aiListening ? t("chat.stopDictation") : t("chat.aiVoiceInput")) : t("chat.voiceMsg")}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </button>
            {input.trim() && (
              <button
                type="submit"
                className="bg-blue-600 text-white p-1.5 sm:p-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
                disabled={uploading}
                title="Enter — отправить, Shift+Enter — новая строка. Правый клик — отложить"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setScheduleMenuPos({ x: rect.left, y: rect.top });
                }}
                onClick={(e) => { if (lpSendFiredRef.current) { e.preventDefault(); e.stopPropagation(); } }}
                {...lpSendHandlers}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
            )}
            </form>
          </div>
        )}

        {/* Context menu: запланировать сообщение (через portal, чтобы не обрезался overflow) */}
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
              Запланировать сообщение
            </button>
          </div>,
          document.body,
        )}

        {/* Context menu: Markdown-форматирование (правый клик по полю ввода) — не выходит за границы чата */}
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
              className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px]"
              style={{ left, top }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100">Форматирование</div>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleFormatBold(); }}>
                <strong>Ж</strong> Жирный
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleFormatItalic(); }}>
                <em>К</em> Курсив
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleFormatStrike(); }}>
                <s>З</s> Зачёркнутый
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleFormatLink(); }}>
                <span className="underline">Ссылка</span>
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleFormatCopyable(); }}>
                Копируемый при клике
              </button>
              <div className="border-t border-slate-100 my-1" />
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2" onClick={() => { handleSwitchLayout(); setFormatMenuPos(null); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 6-6 6 6"/><path d="M11 2v10"/><path d="m19 16-6 6-6-6"/><path d="M13 12v10"/></svg>
                Переключить раскладку
                <span className="ml-auto text-xs text-slate-400">Ctrl+T</span>
              </button>
            </div>
          </>
          );
        })()}

        {/* Modal: новое отложенное сообщение */}
        {showScheduleModal && chatId && (
          <ScheduleMessageModal
            chatId={chatId}
            initialContent={input}
            onClose={() => setShowScheduleModal(false)}
            onSaved={() => { refreshScheduled(); setShowScheduleModal(false); }}
          />
        )}

        {/* Modal: редактирование фото чата */}
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
                  <img src={toSameOriginMediaUrl(chat.avatar_url)} alt={t("chat.chatPhoto")} className="w-48 h-48 rounded-2xl object-cover mb-6" />
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
                  {/* TODO: Генерация аватарки чата с помощью ИИ — интеграция с API, выбор стиля/промпта, загрузка результата как аватар */}
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

        {/* Этап подтверждения фото: кружок, масштаб, сдвиг — после выбора файла */}
        {pendingAvatarFile && chat && (
          <AvatarCropConfirmModal
            file={pendingAvatarFile}
            onConfirm={handleAvatarCropConfirm}
            onCancel={() => setPendingAvatarFile(null)}
          />
        )}
        {/* Редактор аватарки: обрезка, рисование, текст */}
        {showAvatarEditor && chat && (
          <AvatarEditorModal
            imageUrl={toSameOriginMediaUrl(chat.avatar_url ?? undefined) || null}
            onSave={handleAvatarSaveFromEditor}
            onCancel={() => setShowAvatarEditor(false)}
          />
        )}
        {/* Просмотр аватарки в полном размере */}
        {showAvatarFullscreen && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setShowAvatarFullscreen(null)}
            role="button"
            tabIndex={-1}
            aria-label={t("common.close")}
          >
            <img
              src={showAvatarFullscreen}
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
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => { setShowInfo(false); setInfoUserId(null); }}
            aria-hidden
          />
          <aside
            className={`
              fixed inset-0 z-50 bg-white flex flex-col overflow-y-auto
              md:static md:inset-auto md:z-auto md:w-80 md:border-l md:shrink-0
            `}
          >
            <div className="p-3 border-b flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { setShowInfo(false); setInfoUserId(null); }}
                className="md:hidden p-2 -ml-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              {!infoUserId && <div className="relative shrink-0" ref={infoMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowInfoMenu((v) => !v)}
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={t("messenger.menu")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
                {showInfoMenu && (() => {
                    const isPersonal = chat.is_personal;
                    const myMembership = activeMembers.find((m) => m.user.id === myUserId);
                    const adminsCount = activeMembers.filter((m) => m.role === "admin").length;
                    const amIOnlyAdmin = !isPersonal && myMembership?.role === "admin" && adminsCount <= 1;
                    const btnCls = "w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-3";
                    const btnClsRed = "w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 flex items-center gap-3";
                    return (
                      <div className="absolute right-0 top-full mt-1 py-1 min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-lg z-50">
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
                          <div className="relative group/mute">
                            <button type="button" disabled={muteLoading} className={btnCls + " justify-between"}>
                              <span className="flex items-center gap-3">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                {t("messenger.mute")}
                              </span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><path d="m9 18 6-6-6-6"/></svg>
                            </button>
                            <div className="invisible group-hover/mute:visible absolute right-full top-0 pr-1 min-w-[160px] z-50"><div className="py-1 bg-white border border-slate-200 rounded-lg shadow-lg">
                              {(["1h", "3h", "8h", "forever"] as const).map((dur) => (
                                <button key={dur} type="button" onClick={() => { handleMute(dur); setShowInfoMenu(false); }} disabled={muteLoading} className={btnCls}>
                                  {t(dur === "1h" ? "messenger.muteFor1h" : dur === "3h" ? "messenger.muteFor3h" : dur === "8h" ? "messenger.muteFor8h" : "messenger.muteForever")}
                                </button>
                              ))}
                            </div></div>
                          </div>
                        )}
                        {chat.owner?.id === myUserId && (
                          <button type="button" onClick={() => { handleDeleteChat(); setShowInfoMenu(false); }} disabled={deleteLoading} className={btnClsRed}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            {t("common.delete")}
                          </button>
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
                      </div>
                    );
                  })()}
              </div>}
              <h2 className="text-lg font-semibold text-slate-800 truncate flex-1 text-center min-w-0">{infoUserId ? t("chat.profileTitle") : t("chat.aboutChat")}</h2>
              <button type="button" onClick={() => { setShowInfo(false); setInfoUserId(null); }} className="text-slate-400 hover:text-slate-600 p-1 shrink-0">&#10005;</button>
            </div>

            {/* ===== User profile view ===== */}
            {infoUserId && (() => {
              const member = activeMembers.find((m) => m.user.id === infoUserId);
              const profileUser = member?.user ?? (chat.is_personal && chat.other_member?.id === infoUserId ? chat.other_member : null);
              if (!profileUser) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                    <p className="text-sm">Пользователь не найден</p>
                    <button type="button" onClick={() => setInfoUserId(null)} className="mt-3 text-sm text-blue-600 hover:text-blue-800 hover:underline">Назад к чату</button>
                  </div>
                );
              }
              const avatarUrl = (profileUser as User).avatar_url ?? (profileUser as User).avatar ?? null;
              const name = profileUser.display_name || profileUser.phone || "?";
              const isOnline = onlineStatus[profileUser.id]?.is_online;
              const lastSeen = onlineStatus[profileUser.id]?.last_seen_display;
              const isMe = profileUser.id === myUserId;
              return (
                <div className="flex-1 overflow-y-auto">
                  {/* Back to chat info */}
                  <div className="px-3 pt-2 pb-1">
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
                  <div className="flex flex-col items-center px-4 pb-4">
                    <div className="relative">
                      {avatarUrl ? (
                        <button
                          type="button"
                          onClick={() => setShowAvatarFullscreen(toSameOriginMediaUrl(avatarUrl))}
                          className="block rounded-full overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                          title={t("chat.viewPhoto")}
                        >
                          <img src={toSameOriginMediaUrl(avatarUrl)} alt="" className="w-20 h-20 rounded-full object-cover" />
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

                    <h3 className="font-semibold text-slate-800 text-center mt-2">{name}</h3>

                    {/* Online status */}
                    <p className="text-xs mt-0.5">
                      {isOnline ? (
                        <span className="text-green-500 font-medium">{t("chat.online")}</span>
                      ) : lastSeen ? (
                        <span className="text-slate-500">{formatLastSeen(lastSeen, lang)}</span>
                      ) : null}
                    </p>

                    {/* Username & phone */}
                    {((profileUser as User).username || profileUser.phone) && (
                      <div className="mt-2 flex flex-col items-center gap-0.5 text-xs text-slate-500">
                        {(profileUser as User).username && (
                          <span className="font-medium text-slate-700">@{(profileUser as User).username}</span>
                        )}
                        {profileUser.phone && (
                          <span className="text-slate-600">{profileUser.phone}</span>
                        )}
                      </div>
                    )}

                    {/* Role badge (for group members) */}
                    {member && (
                      <div className="mt-2">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${member.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {member.role === "admin" ? t("chat.administrator") : t("chat.member")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="px-4 pb-4 space-y-2">
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

            {/* ===== Chat info view (original) ===== */}
            {!infoUserId && <>
            {(leaveError || deleteError) && (
              <div className="px-4 py-2 border-b bg-red-50 border-red-100">
                <p className="text-xs text-red-600">{leaveError || deleteError}</p>
              </div>
            )}

            {/* Avatar */}
            <div className="flex flex-col items-center mb-3">
              <div className="relative group">
                {chat.is_favorites ? (
                  <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                ) : (chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                  <button
                    type="button"
                    onClick={() => setShowAvatarFullscreen(toSameOriginMediaUrl(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!))}
                    className="block rounded-full overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    title={t("chat.viewPhoto")}
                  >
                    <img src={toSameOriginMediaUrl(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!)} alt="" className="w-20 h-20 rounded-full object-cover" />
                  </button>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
                    {chat.is_personal && chat.other_member
                      ? (chat.other_member.display_name || chat.other_member.phone || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?"
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
                  <h3 className="font-semibold text-slate-800 text-center">{chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}</h3>
                  {chat.owner?.id === myUserId && !chat.is_personal && !chat.is_favorites && (
                    <button type="button" onClick={() => { setTitleDraft(chat.title || ""); setEditingTitle(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 rounded" title={t("chat.editChatName")}>
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
                        {onOpenDmWithUserId && chat.other_member?.id ? (
                          <button
                            type="button"
                            onClick={() => { setUsernameShake(true); setTimeout(() => setUsernameShake(false), 400); }}
                            className={`text-blue-600 hover:text-blue-800 hover:underline font-medium ${usernameShake ? "animate-username-shake" : ""}`}
                            title={t("chat.alreadyInChat")}
                          >
                            @{chat.other_member.username}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-700">@{chat.other_member.username}</span>
                        )}
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
                <p className="text-xs text-slate-500">{formatMembersCount(chat.members_count, lang)}</p>
              )}
              {/* Group tier badge + возраст группы — только для групп */}
              {!chat.is_personal && !chat.is_favorites && (() => {
                const eff = chat.effective_max_members ?? chat.max_members ?? 100;
                const tier = eff >= 10000 ? "mega" : eff >= 1000 ? "kilo" : "default";
                const label = tier === "mega" ? t("chat.megaGroup") : tier === "kilo" ? t("chat.kiloGroup") : t("chat.group");
                const hint = tier === "mega" ? t("chat.upTo10k") : tier === "kilo" ? t("chat.upTo1k") : t("chat.upTo100");
                const colors = tier === "mega" ? "bg-purple-100 text-purple-700" : tier === "kilo" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
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
                          {chat.is_expanded && (
                            <span className="block text-slate-300 mt-0.5">Расширен навсегда</span>
                          )}
                        </span>
                      </span>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{ageStr}</span>
                  </div>
                );
              })()}
            </div>

            {!chat.is_personal && !chat.is_favorites && (
            <div className="mb-3 px-5">
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
                  <div className="mt-0.5">
                    {chat.owner?.id === myUserId ? (
                      <button
                        type="button"
                        onClick={() => { setDescriptionDraft(chat.description || ""); setEditingDescription(true); }}
                        className="w-full text-left rounded px-1 -mx-1 py-0.5 hover:bg-slate-100 transition-colors"
                      >
                        {chat.description ? (
                          (() => {
                            const cleaned = chat.description.replace(/\n{2,}/g, "\n").trim();
                            const lineCount = cleaned.split("\n").length;
                            return (
                              <p className={`text-sm text-slate-700 whitespace-pre-wrap ${lineCount > 5 ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>{cleaned}</p>
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
                              <p className={`text-sm text-slate-700 whitespace-pre-wrap ${lineCount > 5 ? "max-h-[7.5rem] overflow-y-auto" : ""}`}>{cleaned}</p>
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

            {/* Скрытый input для «Изменить фон» из меню (три точки) */}
            {chat.owner?.id === myUserId && (
              <div className="hidden" aria-hidden="true">
                <input ref={backgroundInputRef} type="file" accept="image/*" onChange={handleBackgroundUpload} disabled={backgroundUploading} />
              </div>
            )}

            {/* Тип и пригласительная ссылка — только для групп */}
            {!chat.is_personal && !chat.is_favorites && (
            <div className="space-y-2 px-5">
              {chat.chat_type != null && (
              <div><span className="text-xs text-slate-400 uppercase tracking-wide">{t("chat.type")}</span><p className="text-slate-700">{chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}</p></div>
              )}
              {chat.invite_link && (
                <div>
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Пригласительная ссылка</span>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-slate-100 rounded px-2 py-1 text-slate-600 truncate flex-1">{normalizeInviteLink(chat.invite_link)}</code>
                    <button type="button" onClick={handleCopy} className={`text-xs px-2 py-1 rounded transition-colors ${copiedState ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}>{copiedState ? t("common.copied") : t("common.copy")}</button>
                  </div>
                </div>
              )}
            </div>
            )}

          {/* Расширение за звёзды — только для групп; в личном чате и Избранном не показываем */}
          {!chat.is_personal && !chat.is_favorites && chat.owner?.id === myUserId && (() => {
            const effective = chat.effective_max_members ?? chat.max_members ?? 10;
            const isExpandedTo100 = chat.is_expanded && effective === 100;
            const isExpandedTo1000 = chat.is_expanded && effective === 1000;
            const showUpgradeTo100 = effective < 100;
            const showUpgradeTo1000 = effective === 100;
            if (!showUpgradeTo100 && !showUpgradeTo1000 && !isExpandedTo100 && !isExpandedTo1000) return null;
            return (
              <div className="p-3 border-b space-y-2">
                {showUpgradeTo100 && (
                  <UpgradeTo100Compact />
                )}
                {showUpgradeTo1000 && (
                  <div className="bg-amber-50 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-amber-800 font-medium">&#9733; Прокачать до 1000 участников</p>
                    <p className="text-xs text-amber-700">⭐ 100 звёзд раз и навсегда</p>
                    <button
                      type="button"
                      onClick={() => handleExpandChat(1000)}
                      disabled={expandLoading}
                      className="w-full bg-amber-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      {expandLoading ? "..." : (lang === "en" ? "Upgrade for ⭐ 100 stars" : "Прокачать за ⭐ 100 звёзд")}
                    </button>
                  </div>
                )}
                {isExpandedTo100 && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800 font-medium">&#9733; {lang === "en" ? "Chat expanded to 100 members forever" : "Чат расширен до 100 участников навсегда"}</p>
                  </div>
                )}
                {isExpandedTo1000 && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800 font-medium">&#9733; {lang === "en" ? "Chat expanded to 1000 members forever" : "Чат расширен до 1000 участников навсегда"}</p>
                  </div>
                )}
                {expandError && <p className="text-xs text-red-500">{expandError}</p>}
                {/* Подсказка: при нехватке звёзд — поделиться реферальной ссылкой */}
                {(expandError?.includes("Недостаточно") || expandError?.includes("Not enough") || showUpgradeTo1000) && (
                  <ReferralHintInChat />
                )}
              </div>
            );
          })()}

          <div className="p-3">
            {/* Медиа, Ссылки, Файлы; в группах — вкладка Участники */}
            {(() => {
              // Группа из 2 человек остаётся групповым чатом (название, аватар, блоки, подпись «N участников»). Личный только при chat.is_personal.
              const isGroup = !chat.is_personal;
              const isImage = (msg: Message) => {
                if (msg.msg_type === "image") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("image/"));
              };
              const isVideo = (msg: Message) => {
                if (msg.msg_type === "audio") return false;
                if (msg.msg_type === "video" || msg.msg_type === "video_circle") return true;
                const mime = (msg.file && typeof msg.file === "object" && "mime_type" in msg.file) ? (msg.file as { mime_type?: string }).mime_type : "";
                return !!(mime && mime.startsWith("video/"));
              };
              const isImageOrVideo = (msg: Message) => isImage(msg) || isVideo(msg);
              const mediaMessages = messages.filter((m) => m && isImageOrVideo(m));
              const urlRe = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
              const linkMessages = messages.filter((m) => m?.content && urlRe.test(m.content));
              const fileMessages = messages.filter((m) => {
                if (!m || !m.file) return false;
                if (isImageOrVideo(m)) return false;
                return m.msg_type === "file" || m.msg_type === "audio" || (m.file && typeof m.file === "object");
              });
              const thumbUrl = (msg: Message) => {
                const f = msg.file && typeof msg.file === "object" && "url" in msg.file ? (msg.file as { url?: string }).url : null;
                const files = (msg.files ?? []) as { url?: string }[];
                return f || files[0]?.url;
              };
              const showParticipants = isGroup && !chat.is_favorites;
              const tabs: { id: "media" | "links" | "files" | "participants"; label: string }[] = showParticipants
                ? [
                    { id: "participants" as const, label: t("chat.participants") },
                    { id: "media", label: t("chat.media") },
                    { id: "links", label: t("chat.links") },
                    { id: "files", label: t("chat.files") },
                  ]
                : [
                    { id: "media", label: t("chat.media") },
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
                            <label className="block text-sm font-medium text-slate-600 mb-2">Пригласить по username</label>
                            <input
                              type="text"
                              placeholder={t("chat.enterUsername")}
                              value={inviteSearchQuery}
                              onChange={(e) => setInviteSearchQuery(e.target.value)}
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            {inviteError && <p className="text-red-500 text-xs mt-1">{inviteError}</p>}
                            {inviteSearchLoading && <p className="text-slate-500 text-xs mt-1">Поиск...</p>}
                            {inviteSearchResults.length > 0 && (
                              <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50">
                                {inviteSearchResults
                                  .filter((u) => !activeMembers.some((m) => m.user.id === u.id))
                                  .map((u) => (
                                    <li key={u.id}>
                                      <button
                                        type="button"
                                        disabled={inviteLoading}
                                        onClick={() => handleInviteUser(u.id)}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-200 text-sm flex items-center gap-2"
                                      >
                                        <span className="font-medium truncate">{u.display_name || u.username || u.id}</span>
                                        {u.username && <span className="text-slate-500 truncate">@{u.username}</span>}
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
                                <div className="relative shrink-0">
                                  <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-semibold">{getAvatarInitials(m.user.display_name || m.user.phone)}</div>
                                  {onlineStatus[m.user.id]?.is_online && (
                                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  {openDm ? (
                                    <button type="button" onClick={openDm} className="text-left w-full min-w-0 block truncate text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
                                      {m.user.display_name || m.user.phone}
                                    </button>
                                  ) : (
                                    <p className="text-sm text-slate-800 truncate">{m.user.display_name || m.user.phone}</p>
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
                                  <div className="w-8 h-8 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center text-sm font-semibold shrink-0">{getAvatarInitials(m.user.display_name || m.user.phone)}</div>
                                  <div className="flex-1 min-w-0"><p className="text-sm text-slate-600 truncate">{m.user.display_name || m.user.phone}</p></div>
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
                              <ProgressiveImage src={toSameOriginMediaUrl(url) || url} alt="" className="w-full h-full" objectFit="cover" />
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
            </>}
        </aside>
        </>
      )}
      </div>
    </div>
  );
}

/* ================================================================
   UpgradeTo100Compact — компактный блок: до 100 участников + реферальная ссылка + кнопка Личный кабинет
   ================================================================ */
function UpgradeTo100Compact() {
  const { t } = useTranslation();
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authApi.me().then((r) => {
      const code = r.data.referral_code;
      if (code) setReferralLink(`${window.location.origin}/auth?ref=${code}`);
    }).catch(() => {});
  }, []);

  const handleCopy = () => {
    if (!referralLink) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(referralLink).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("chat.shareTitle"),
          text: t("chat.shareText"),
          url: referralLink,
        });
      } catch { /* user cancelled or error */ }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="bg-amber-50 rounded-xl p-3 space-y-3 border border-amber-100">
      <p className="text-xs text-amber-800 leading-snug">
        {t("chat.upgradeDesc")}
      </p>
      <Link
        to="/chats"
        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm hover:shadow transition-all focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-amber-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        {t("dashboard.title")}
      </Link>
      <div className="flex items-center gap-2 pt-1 border-t border-amber-200/60">
        <p className="text-xs text-amber-700 flex-1 min-w-0 truncate">{t("chat.inviteFriendsStars")}</p>
        {referralLink && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-200/80 transition-colors"
              title={t("chat.copyLink")}
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              )}
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-200/80 transition-colors"
              title={t("chat.share")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   ReferralHintInChat — подсказка «поделиться реферальной ссылкой» при нехватке звёзд
   ================================================================ */
function ReferralHintInChat() {
  const { t } = useTranslation();
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authApi.me().then((r) => {
      const code = r.data.referral_code;
      if (code) setReferralLink(`${window.location.origin}/auth?ref=${code}`);
    }).catch(() => {});
  }, []);

  const handleCopy = () => {
    if (!referralLink) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(referralLink).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("chat.shareTitle"),
          text: t("chat.shareText"),
          url: referralLink,
        });
      } catch { /* user cancelled or error */ }
    } else {
      handleCopy();
    }
  };

  if (!referralLink) return <p className="text-xs text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs text-slate-700">
        Не хватает звёзд? Копируй реферальную ссылку и отправляй друзьям — ты и друг получите по <strong>⭐ 10 звёзд</strong>, а друг ещё и месяц бесплатного пользования сервиса.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 truncate flex-1 min-w-0" title={referralLink}>{referralLink}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
            title={t("chat.copyLink")}
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
            title={t("chat.share")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MessageBubble
   ================================================================ */


/** Сообщение состоит только из эмодзи (и пробелов) — показываем без рамки, крупнее. Только цифры не считаем эмодзи. */
function isOnlyEmoji(str: string): boolean {
  const t = str.trim();
  if (t.length === 0 || t.length > 30) return false;
  if (/^[\d\s]+$/.test(t)) return false;
  return /^[\p{Emoji}\s]+$/u.test(t) && /[\p{Emoji}]/u.test(t);
}

const MESSAGE_TEXT_BASE_PX = 13;
const MESSAGE_EMOJI_BASE_PX = 28;

/** Имя файла: если помещается в полэкрана — целиком без переноса; иначе начало + "....." + последние 5 символов + расширение */
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
      <span className={`underline text-sm whitespace-nowrap overflow-hidden text-ellipsis block ${className}`} title={display.full ? undefined : fileName}>
        {display.text}
      </span>
    </span>
  );
}

/** Разделитель даты между сообщениями (Сегодня, Вчера, 15 февраля) */
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


function ForwardModal({ message, sourceChatId, onClose, onForwardComplete }: { message: Message; sourceChatId: string; onClose: () => void; onForwardComplete?: (targetChatIds: string[]) => void }) {
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
    return c.title.toLowerCase().includes(q) || (c.other_member?.display_name || "").toLowerCase().includes(q);
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
        const res = await messagesApi.forward(targetChatId, { message_id: message.id, source_chat_id: sourceChatId });
        storeUpsertMessage(targetChatId, storeNormalizeMessage({ ...res.data, chat: targetChatId } as Message & { chat: string }));
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
          <h3 className="text-sm font-semibold text-slate-800">{t("chat.forwardMessage")}</h3>
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
                const chatTitle = c.is_favorites ? t("chat.favoritesTitle") : c.is_personal && c.other_member ? (c.other_member.display_name || c.other_member.phone) : c.title;
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
                    <span className="flex-1 text-sm text-slate-800 truncate">{chatTitle}</span>
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

function SingleImageModal({ url, fileName, onClose }: { url: string; fileName?: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  const resolvedUrl = toSameOriginMediaUrl(url) || url;
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/90 flex items-center justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div className="w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        <ProgressiveImage
          src={resolvedUrl}
          alt={fileName || ""}
          className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg shadow-2xl"
          loading="eager"
          preserveAnimation={/\.gif$/i.test(fileName || "")}
          useOriginalQuality
        />
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="fixed top-4 right-4 z-[111] bg-white/90 hover:bg-white text-slate-800 rounded-full w-9 h-9 flex items-center justify-center shadow-lg transition-colors"
        aria-label={t("common.close")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

type MessageBubbleProps = {
  message: Message;
  isMine: boolean;
  chatId: string;
  textScale: number;
  /** Показывать аватар (false — placeholder для группировки сообщений) */
  showAvatar?: boolean;
  /** Последнее сообщение в группе (хвостик в сторону аватарки) */
  isLastInGroup?: boolean;
  onMessageUpdated: (msg: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  /** Для сообщений только из эмодзи — редактировать в поле ввода, а не инлайном */
  onStartEditInInput?: (messageId: string, content: string) => void;
  /** Клик по одиночному изображению — открыть в модалке вместо новой вкладки */
  onImageClick?: (url: string, fileName?: string) => void;
  /** Может ли текущий пользователь закрепить сообщение для всех (админ/владелец) */
  canPinForAll?: boolean;
  /** ID сообщений, закреплённых для всех в чате */
  pinnedForAllIds?: string[];
  /** Максимально допустимое кол-во закреплённых для всех */
  maxPins?: number;
  /** Клик по аватарке отправителя (открыть информацию о пользователе) */
  onAvatarClick?: (userId?: string) => void;
  /** ID сообщений, закреплённых текущим пользователем для себя */
  myPinnedIds?: string[];
  /** Вызов после закрепления/открепления (обновить чат) */
  onPinChange?: () => void;
  /** Ответить на сообщение */
  onReply?: (message: Message) => void;
  /** Переслать сообщение */
  onForward?: (message: Message) => void;
};

const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  chatId,
  textScale,
  showAvatar = true,
  isLastInGroup = false,
  onMessageUpdated,
  onMessageDeleted,
  onStartEditInInput,
  onImageClick,
  canPinForAll,
  pinnedForAllIds,
  maxPins,
  myPinnedIds,
  onPinChange,
  onReply,
  onForward,
  onAvatarClick,
}: MessageBubbleProps) {
  const { t, lang } = useTranslation();
  const [hoverDelayPassed, setHoverDelayPassed] = useState(false);
  const hoverDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickerHover, setPickerHover] = useState(false);
  const pickerVisible = !isMine && (hoverDelayPassed || pickerHover);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || "");
  const [reactionLoading, setReactionLoading] = useState(false);
  const [reactionLimitToast, setReactionLimitToast] = useState(false);
  const reactionLimitToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuCopied, setContextMenuCopied] = useState(false);
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
  }, []);

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

  // Deleted message placeholder
  if (message.is_deleted) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-slate-400 italic">{t("chat.messageDeleted")}</span>
      </div>
    );
  }

  const isFile = message.msg_type !== "text" && message.msg_type !== "emoji" && message.msg_type !== "gif" && message.msg_type !== "sticker";
  const isGif = message.msg_type === "gif" && message.content;
  const isSticker = message.msg_type === "sticker" && message.content;
  const senderName = getSenderName(message);
  const content = message.content || t("common.fileMsg");
  const isShortText = !isFile && !content.includes("\n") && content.length <= 40;
  const isEmojiOnly = !isFile && !content.includes("\n") && isOnlyEmoji(content);
  const reactions = message.reactions ?? {};
  const myReactions: string[] = message.my_reactions ?? [];
  const canEdit = isMine && !isFile && message.msg_type === "text";
  const canAddReaction = myReactions.length < 3;

  const rawFileUrl = message.file ? ((message.file as { url?: string }).url || "#") : "#";
  const fileUrl = useCachedMediaUrl(rawFileUrl !== "#" ? rawFileUrl : null) || rawFileUrl;
  const fileName = message.file ? (message.file as { original_name?: string }).original_name || message.content : message.content;
  const fileMime = (message.file && (message.file as { mime_type?: string }).mime_type) || "";
  const isImageByMime = fileMime.startsWith("image/");
  const isVideoByMime = fileMime.startsWith("video/");
  const ext = (fileName || "").toLowerCase().replace(/.*\./, "");
  const isImageByExt = /^(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/.test(ext);
  const isVideoByExt = /^(mp4|webm|mov|avi|mkv|ogv)$/.test(ext);
  const fileIsImage = isImageByMime || (message.file && !fileMime && isImageByExt);
  const fileIsVideo = isVideoByMime || (message.file && !fileMime && isVideoByExt);
  // Показывать как ссылку только для не-медиа; картинки и видео — всегда с превью
  const isImage = message.file && fileIsImage;
  // fileUrl is used directly for all media types
  const isAudio = message.msg_type === "audio" || (message.file && (message.file as { mime_type?: string }).mime_type?.startsWith("audio/"));
  const isVideo = message.file && !isAudio && (message.msg_type === "video" || fileIsVideo);
  const isVideoCircle = message.msg_type === "video_circle" && !isAudio && message.file;

  // Несколько изображений — плитка; учитываем mime и расширение
  const allFiles = (message.files ?? []).filter((f) => f != null && typeof f === "object" && "id" in f) as Message["files"];
  const imageFiles = allFiles.filter((f) => (f.mime_type || "").startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(f.original_name || ""));
  const isMultiImage = imageFiles.length > 1;
  const isImageBubble = isVideoCircle || isMultiImage || (isFile && isImage);

  const locale = getLocale(lang);
  const timeStr = new Date(message.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const editedStr = message.edited_at
    ? new Date(message.edited_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : null;
  const isPendingOutbox = isMine && message.sender?.id === "self";
  const readStatus = isMine ? (isPendingOutbox ? "pending" : (message.read_status || "delivered")) : null;
  const Checkmarks = readStatus === "pending" ? (
    <span className="ml-1 inline-flex" title={t("chat.sending")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 animate-pulse"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </span>
  ) : readStatus === "read" ? (
    <span className="ml-1 inline-flex" title={t("chat.read")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 -ml-1"><path d="M20 6 9 17l-5-5"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 -ml-2.5"><path d="M20 6 9 17l-5-5"/></svg>
    </span>
  ) : readStatus === "delivered" ? (
    <span className="ml-1 inline-flex" title={t("chat.delivered")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600"><path d="M20 6 9 17l-5-5"/></svg>
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
      const res = await messagesApi.setReaction(chatId, message.id, emoji);
      onMessageUpdated(storeNormalizeMessage(res.data));
    } finally {
      setReactionLoading(false);
    }
  };

  const handleSaveEdit = () => {
    const text = editText.trim();
    if (text === (message.content || "")) {
      setEditing(false);
      return;
    }
    if (!text) return;
    messagesApi.update(chatId, message.id, { content: text }).then((res) => {
      onMessageUpdated(normalizeMessage(res.data));
      setEditing(false);
      setEditText(res.data.content || "");
    });
  };

  const handleCancelEdit = () => {
    setEditText(message.content || "");
    setEditing(false);
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      closeContextMenu();
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  /** Тачпад: смахивание 2 пальцами вправо — ответ на сообщение */
  useEffect(() => {
    const el = messageWrapperRef.current;
    if (!el || !onReply) return;
    const WHEEL_THRESHOLD = 80;
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (e.deltaX < WHEEL_THRESHOLD) return;
      e.preventDefault();
      onReply(message);
      if (navigator.vibrate) navigator.vibrate(15);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [message, onReply]);

  const handleDelete = () => {
    closeContextMenu();
    messagesApi.delete(chatId, message.id).then(() => {
      onMessageDeleted?.(message.id);
    });
  };

  const hasReactions = Object.keys(reactions).length > 0;
  const reactionEntries = Object.entries(reactions).filter(([, c]) => c > 0);

  const reactionCount = reactionEntries.length;
  const allowReactionWrap = reactionCount >= 5;
  const reactionButtons = hasReactions ? (
    <span className={`inline-flex items-center gap-x-1 gap-y-0.5 ${allowReactionWrap ? "flex-wrap" : "flex-nowrap"}`}>
      {reactionEntries.map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleReaction(emoji)}
          className={`inline-flex items-center rounded px-1 py-0.5 text-xs transition-colors cursor-pointer shrink-0 ${
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

  /** Время (+ ред.) + галочки — последовательно в одну линию */
  const timeEl = (
    <span className={`inline-flex flex-nowrap items-center gap-x-1 text-[10px] min-w-0 shrink-0 whitespace-nowrap ${isMine ? "text-slate-500" : "text-slate-400"}`}>
      {timeStr}
      {editedStr && <span className="opacity-80 ml-0.5">ред. {editedStr}</span>}
      {Checkmarks}
    </span>
  );

  const handleMouseEnter = () => {
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
    hoverDelayTimerRef.current = setTimeout(() => setHoverDelayPassed(true), 400);
  };
  const handleMouseLeave = () => {
    setPickerHover(false);
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
      hoverDelayTimerRef.current = null;
    }
    setHoverDelayPassed(false);
  };

  return (
    <div
      ref={messageWrapperRef}
      className={`relative flex w-full justify-start ${hasReactions ? "mb-px" : ""}`}
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
      {/* Обёртка: [reply icon при свайпе] [аватар + пузырь + реакции] */}
      <div
        ref={swipeWrapperRef}
        className={`relative flex flex-row flex-nowrap items-end gap-2 swipe-message w-full ${swipeBounce ? "swipe-bounce" : ""}`}
        style={swipeBounce ? { "--swipe-from": `${swipeBounceFromRef.current}px` } as React.CSSProperties : undefined}
        onAnimationEnd={() => setSwipeBounce(false)}
      >
        {onReply && (
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
      <div className="relative inline-flex items-end gap-1.5 min-w-0 max-w-[88%] shrink-0">
        {(showAvatar ? (
          (() => {
            const sender = message.sender as User;
            const avatarUrl = sender?.avatar_url ?? sender?.avatar ?? null;
            return (
              <button
                type="button"
                onClick={() => onAvatarClick?.(sender?.id)}
                className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden bg-slate-200 cursor-pointer hover:ring-2 hover:ring-blue-300 transition-shadow"
                title={senderName}
              >
                {avatarUrl ? (
                  <img src={toSameOriginMediaUrl(avatarUrl)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-semibold text-slate-600">
                    {getAvatarInitials(senderName)}
                  </span>
                )}
              </button>
            );
          })()
        ) : (
          <div className="w-8 h-8 shrink-0" aria-hidden />
        ))}
        <div
          className="relative flex flex-col min-w-0 group items-start"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
        {isEmojiOnly && !editing ? (
          <div className="inline-flex flex-col gap-0.5 max-w-full min-w-0">
            <div className="inline-flex items-center gap-2 flex-wrap" style={{ fontSize: `${MESSAGE_EMOJI_BASE_PX * textScale}px` }}>
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
        <div className={`inline-block max-w-full ${isLastInGroup ? "relative overflow-visible" : ""}`}>
        <div className={`inline-block max-w-full ${message.edited_at ? "min-w-fit" : "min-w-0"} ${isImageBubble || isSticker ? "rounded-2xl p-0 overflow-visible" : isShortText ? "overflow-visible" : "overflow-hidden"} ${isImageBubble || isSticker ? "rounded-2xl p-0" : isMultiImage ? `rounded-2xl p-0 ${isMine ? "bg-blue-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"}` : `rounded-2xl px-3 py-1.5 ${isMine ? "bg-blue-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"}`} ${isLastInGroup ? "rounded-bl-[4px]" : ""}`} style={{ fontSize: `${MESSAGE_TEXT_BASE_PX * textScale}px` }}>
          {/* Forwarded header */}
          {message.forwarded_from && (
            <div className="flex items-center gap-1 text-xs text-slate-500 italic mb-0.5 -mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              <span>Переслано от <strong className="not-italic font-medium text-slate-600">{(message.forwarded_from as User).display_name || (message.forwarded_from as User).phone}</strong></span>
              {message.forwarded_from_chat_title && (
                <span className="text-slate-400 ml-0.5">из «{message.forwarded_from_chat_title}»</span>
              )}
            </div>
          )}
          {/* Reply quote block — для своих сообщений прижата к правому краю */}
          {message.reply_to && !message.reply_to.is_deleted && (
            <div className="mb-0.5 -mt-0.5">
              <button
                type="button"
                className={`rounded-lg px-2 py-0.5 border-l-[3px] w-full text-left ${isMine ? "border-blue-400 bg-blue-50/50" : "border-slate-400 bg-slate-50/50"} cursor-pointer hover:opacity-80`}
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
                <div className="text-xs font-medium text-blue-600 truncate">
                  {(message.reply_to.sender as User)?.display_name || (message.reply_to.sender as User)?.phone || ""}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {message.reply_to.msg_type === "gif"
                    ? "(GIF)"
                    : message.reply_to.msg_type === "sticker"
                      ? t("common.stickerMsg")
                      : message.reply_to.msg_type !== "text" && message.reply_to.msg_type !== "emoji"
                        ? t("common.fileMsg")
                        : (message.reply_to.content || "").trim().slice(0, 80)}
                </div>
              </button>
            </div>
          )}
          {message.reply_to && message.reply_to.is_deleted && (
            <div className="mb-0.5 -mt-0.5">
              <div className="rounded-lg px-2 py-0.5 border-l-[3px] border-slate-300 bg-slate-50/50 w-full text-left">
                <div className="text-xs text-slate-400 italic">{t("chat.messageDeleted")}</div>
              </div>
            </div>
          )}
          {editing ? (
            <div className="min-w-[240px] max-w-full">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
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
              <VideoCirclePlayer src={fileUrl} />
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isVideo ? (
            <div className="min-w-0 max-w-full">
              <InlineAutoplayVideo src={fileUrl} className="max-w-[300px] max-h-80 rounded-lg" />
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isGif ? (
            <div className="min-w-0 max-w-full">
              <img src={content} alt="" className="max-w-[280px] max-h-80 rounded-xl object-contain" style={{ maxHeight: "280px" }} />
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isSticker ? (
            <div className="min-w-0 max-w-full">
              {(() => {
                const stickerPath = content.startsWith("/") ? content : `/${content.replace(/^\/+/, "")}`;
                const stickerAnim = getStickerAnimationUrl(stickerPath);
                return stickerAnim
                  ? <LottieSticker animationUrl={stickerAnim} size={112} />
                  : <img src={stickerPath} alt="" className="w-28 h-28 object-contain" />;
              })()}
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isMultiImage ? (
            <div className="relative min-w-0 max-w-full">
              <ImageTileGrid images={imageFiles} />
              {/* Time/reactions overlay on bottom-right of image grid */}
              <div className="absolute bottom-1.5 left-2 flex items-center gap-x-1 px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-white [&_span]:!text-white/90">
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isFile && message.file ? (
            <div className={`min-w-0 max-w-full ${isImage ? "min-w-[180px]" : ""}`}>
              {isImage ? (
                onImageClick ? (
                  <ProgressiveImage
                    src={fileUrl}
                    alt={fileName}
                    className="w-full max-w-[520px] rounded-xl cursor-pointer border border-slate-200/30 shadow-sm"
                    wrapper="button"
                    onClick={() => onImageClick(fileUrl, fileName)}
                    preserveAnimation={fileMime.includes("gif")}
                    fullWidth={1200}
                  />
                ) : (
                  <ProgressiveImage
                    src={fileUrl}
                    alt={fileName}
                    className="w-full max-w-[520px] rounded-xl cursor-pointer border border-slate-200/30 shadow-sm"
                    wrapper="a"
                    href={fileUrl}
                    preserveAnimation={fileMime.includes("gif")}
                    fullWidth={1200}
                  />
                )
              ) : isAudio ? (
                (message as { waveform?: number[] }).waveform?.length ? (
                  <AudioMessagePlayer
                    fileUrl={fileUrl}
                    waveform={(message as { waveform?: number[] }).waveform!}
                    isMine={isMine}
                  />
                ) : (
                  <SimpleAudioPlayer fileUrl={fileUrl} isMine={isMine} />
                )
              ) : (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col min-w-[200px] max-w-full overflow-hidden rounded-lg cursor-pointer ${isMine ? "text-blue-700 hover:bg-blue-200/80" : "text-blue-600 hover:bg-slate-50 hover:text-blue-800"}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <FileNameDisplay fileName={fileName} />
                  </span>
                </a>
              )}
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1 gap-y-0 justify-start`}>
                {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}
              </div>
            </div>
          ) : isShortText ? (
            <>
              <div className="inline-flex items-baseline gap-x-1.5 flex-nowrap leading-snug whitespace-nowrap">
                <MarkdownMessageContent content={content} isMine={isMine} className="inline" inline />
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
                <MarkdownMessageContent content={content} isMine={isMine} className="inline" inline />
                <span className="invisible inline-flex items-center whitespace-nowrap ml-1.5 text-[10px]">{timeEl}</span>
                <span className="absolute bottom-[1px] right-0 z-10">{timeEl}</span>
              </div>
              {hasReactions && (
                <div className="flex flex-wrap gap-x-1 gap-y-0.5 mt-px animate-reactions-appear justify-start -ml-1 mr-1">
                  {reactionButtons}
                </div>
              )}
            </>
          )}
        </div>
        {isLastInGroup && !isSticker && !isImageBubble && (
          <div
            className={`absolute w-0 h-0 border-[6px] border-transparent bottom-[10px] left-0 -ml-px ${isMine ? "border-r-blue-100" : "border-r-white"}`}
            aria-hidden
          />
        )}
        </div>
        )}
        {/* Reaction picker — слева от bubbleColumn (для isMine), справа (для !isMine) */}
        {isMine && hoverDelayPassed && !editing && (
          <div
            className="absolute bottom-1 left-full ml-0.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
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
        {!isMine && pickerVisible && (
          <div
            className="absolute bottom-1 left-full ml-0.5 z-20 flex items-center gap-1"
            onMouseEnter={() => setPickerHover(true)}
            onMouseLeave={() => setPickerHover(false)}
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
            {/* 1. Ответить */}
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
          {/* 3. Копировать */}
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
            onClick={() => {
              const text = isFile ? t("common.fileMsg") : (message.content || "");
              copyToClipboard(text).then(() => {
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            {contextMenuCopied ? t("common.copied") : t("common.copy")}
          </button>
          {/* 4. Копировать для Word */}
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
            onClick={() => {
              const raw = isFile ? t("common.fileMsg") : (message.content || "");
              const text = isFile ? raw : stripMarkdown(raw);
              copyToClipboard(text).then(() => {
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            {t("chat.copyForWord")}
          </button>
          {/* 5. Редактировать */}
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
          {/* 6. Удалить */}
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
                        <img src={toSameOriginMediaUrl(u.avatar_url ?? u.avatar)!} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {getAvatarInitials(u.display_name || u.phone || u.telegram_username || u.id)}
                        </div>
                      )}
                      <span className="truncate min-w-0">{u.display_name || u.phone || u.telegram_username || u.id}</span>
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
   VideoCirclePlayer — круглое видео (кружочек)
   ================================================================ */

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ================================================================
   SimpleAudioPlayer — аудио без волны: кнопка play, прогресс-бар, длительность
   ================================================================ */

function SimpleAudioPlayer({ fileUrl, isMine }: { fileUrl: string; isMine: boolean }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;
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
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (duration <= 0) syncDuration(el);
    };
    const onLoadedMetadata = () => syncDuration(el);
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    syncDuration(el);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [syncDuration]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(duration) || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    el.currentTime = percent * duration;
    setCurrentTime(el.currentTime);
  };

  return (
    <div className="flex items-center gap-2.5 my-0.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={fileUrl} preload="metadata" className="hidden" />
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
        <div
          className="flex items-end gap-[2px] h-5 cursor-pointer select-none"
          onClick={handleBarClick}
          role="button"
          aria-label={t("chat.seekWave")}
        >
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
        <div className={`text-xs tabular-nums ${isMine ? "text-slate-600" : "text-slate-500"}`}>
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   AudioWaveform — полоски амплитуд, прогресс (0..1), клик по волне = перемотка
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

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percent);
  };

  return (
    <div
      className="flex items-end gap-0.5 h-5 cursor-pointer select-none"
      onClick={handleClick}
      role={onSeek ? "button" : undefined}
      aria-label={onSeek ? t("chat.seekWave") : undefined}
    >
      {waveform.map((v, i) => {
        const played = (i + 1) / n <= progress;
        return (
          <div
            key={i}
            className={`w-1 rounded-full min-h-[2px] transition-colors pointer-events-none ${played ? playedCls : unplayedCls}`}
            style={{ height: `${Math.max(2, (v / 255) * maxH)}px` }}
          />
        );
      })}
    </div>
  );
}

/* ================================================================
   AudioMessagePlayer — волна + отдельная кнопка play, без белого блока
   ================================================================ */

function AudioMessagePlayer({ fileUrl, waveform, isMine }: { fileUrl: string; waveform: number[]; isMine: boolean }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  const syncDuration = useCallback((el: HTMLAudioElement) => {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (duration <= 0) syncDuration(el);
    };
    const onLoadedMetadata = () => syncDuration(el);
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    syncDuration(el);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [syncDuration]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

  const handleSeek = (percent: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(duration) || duration <= 0) return;
    const time = Math.max(0, Math.min(duration, percent * duration));
    el.currentTime = time;
    setCurrentTime(time);
  };

  return (
    <div className="flex items-center gap-2.5 my-0.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={fileUrl} preload="metadata" className="hidden" />
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
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ImageTileGrid — плиточное отображение нескольких изображений
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

function ImageTileGrid({ images }: { images: { id: string; url?: string | null; original_name?: string; mime_type?: string }[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [dims, setDims] = useState<(ImgDims | null)[]>([]);
  const maxShow = 6;
  const visibleImages = images.slice(0, maxShow);
  const hiddenCount = images.length - maxShow;
  const maxH = useMaxTileH();

  useEffect(() => {
    let cancelled = false;
    const results: (ImgDims | null)[] = new Array(visibleImages.length).fill(null);
    let loaded = 0;
    visibleImages.forEach((img, idx) => {
      const url = toSameOriginMediaUrl(img.url || "#") || "#";
      if (!url || url === "#") { loaded++; return; }
      const el = new Image();
      el.onload = () => {
        if (cancelled) return;
        results[idx] = { w: el.naturalWidth, h: el.naturalHeight, ratio: el.naturalWidth / el.naturalHeight };
        loaded++;
        if (loaded === visibleImages.length) setDims([...results]);
      };
      el.onerror = () => { loaded++; if (loaded === visibleImages.length && !cancelled) setDims([...results]); };
      el.src = url;
    });
    return () => { cancelled = true; };
  }, [images.map(i => i.id).join(",")]);

  const count = visibleImages.length;
  const allLoaded = dims.length === count;
  const d = (i: number): ImgDims => dims[i] || { w: 400, h: 300, ratio: 4 / 3 };

  const clampW = (w: number) => Math.min(Math.max(w, TILE_MIN_W), TILE_MAX_W);

  const renderTile = (img: typeof visibleImages[0], idx: number, style: React.CSSProperties) => {
    const url = toSameOriginMediaUrl(img.url || "#") || "#";
    const isLast = idx === maxShow - 1 && hiddenCount > 0;
    return (
      <div key={img.id} className="relative cursor-pointer overflow-hidden" style={style} onClick={() => setLightboxIdx(idx)}>
        <ProgressiveImage
          src={url}
          alt={img.original_name || ""}
          className="w-full h-full hover:scale-105 transition-transform duration-200"
          objectFit="cover"
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

  const fallbackLayout = () => {
    const fbH = Math.min(180, maxH / 2);
    if (count === 1) return <div className="rounded-xl overflow-hidden" style={{ width: 400, height: Math.min(260, maxH) }}>{renderTile(visibleImages[0], 0, { width: "100%", height: "100%" })}</div>;
    if (count === 2) {
      return (
        <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 400, gap: TILE_GAP }}>
          {renderTile(visibleImages[0], 0, { width: "100%", height: fbH })}
          {renderTile(visibleImages[1], 1, { width: "100%", height: fbH })}
        </div>
      );
    }
    return (
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 400, gap: TILE_GAP }}>
        {renderTile(visibleImages[0], 0, { width: "100%", height: fbH })}
        <div className="flex flex-row" style={{ gap: TILE_GAP, height: fbH * 0.75 }}>
          {visibleImages.slice(1).map((img, i) => renderTile(img, i + 1, { flex: 1, height: "100%" }))}
        </div>
      </div>
    );
  };

  return (
    <>
      {allLoaded ? buildLayout() : fallbackLayout()}
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
  const url = toSameOriginMediaUrl(img?.url || "#") || "#";

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
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" onClick={onClose}>
      <div className="relative w-full h-full flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        <ProgressiveImage
          src={url}
          alt={img?.original_name || ""}
          className="max-w-full max-h-full object-contain rounded-lg"
          loading="eager"
          preserveAnimation={/\.gif$/i.test(img?.original_name || "")}
          useOriginalQuality
        />

        {/* Навигация */}
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

        {/* Счётчик */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-3 py-1 rounded-full">
          {idx + 1} / {images.length}
        </div>
      </div>
      {/* Закрыть — в углу экрана, не поверх контента */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="fixed top-4 right-4 z-[101] bg-white/90 hover:bg-white text-slate-800 rounded-full w-9 h-9 flex items-center justify-center shadow-lg transition-colors"
        aria-label={t("common.close")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

function VideoCirclePlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  const syncDuration = useCallback((el: HTMLVideoElement) => {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (duration <= 0) syncDuration(el);
    };
    const onLoadedMetadata = () => syncDuration(el);
    const onDurationChange = () => syncDuration(el);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    syncDuration(el);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
    };
  }, [syncDuration, duration]);

  /* Автовоспроизведение при появлении в зоне видимости (muted) */
  useEffect(() => {
    const el = videoRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    el.muted = true;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.isIntersecting) {
          el.play().then(() => setPlaying(true)).catch(() => {});
        } else {
          el.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.25, rootMargin: "50px" }
    );
    io.observe(container);
    return () => io.disconnect();
  }, [src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(duration) || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    v.currentTime = percent * duration;
    setCurrentTime(v.currentTime);
    e.stopPropagation();
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="relative w-48 h-48 rounded-full overflow-hidden cursor-pointer group bg-black"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-cover"
          preload="metadata"
          playsInline
          loop
          muted
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        />
        {/* Play overlay */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none">
              <polygon points="8 5 19 12 8 19 8 5" />
            </svg>
          </div>
        )}
        {/* Gradient ring */}
        <div className="absolute inset-0 rounded-full ring-2 ring-blue-400/50 pointer-events-none" />
      </div>
      <div className="w-full max-w-[12rem] flex flex-col gap-0.5">
        <div
          role="progressbar"
          aria-valuenow={progress * 100}
          className="h-1.5 w-full rounded-full overflow-hidden cursor-pointer bg-slate-200"
          onClick={handleBarClick}
        >
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="text-xs text-slate-500 text-center">
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ScheduleMessageModal — форма отложенного/рекуррентного сообщения
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
  const [scheduledAt, setScheduledAt] = useState("");
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
    setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }, []);

  // При повторении подставлять время из выбранной даты
  useEffect(() => {
    if (recurrence !== "none" && scheduledAt) {
      const match = scheduledAt.match(/T(\d{2}:\d{2})/);
      if (match) setRecurrenceTime(match[1]);
    }
  }, [recurrence, scheduledAt]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
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
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[80px]"
              placeholder={t("chat.messagePlaceholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("chat.scheduleLabelWhen")}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
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
    </div>
  );
}
