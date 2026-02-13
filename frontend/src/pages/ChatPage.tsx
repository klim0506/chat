import { useEffect, useLayoutEffect, useState, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatsApi, messagesApi, filesApi, scheduledApi, paymentsApi, authApi } from "../api/client";
import type { Chat, ChatMember, Message, User, ScheduledMessage as ScheduledMessageType } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore } from "../store/preferences";
import { getAvatarInitials } from "../lib/avatar-initials";
import { showMessageNotification } from "../lib/notifications";
import { AvatarEditorModal } from "../components/AvatarEditorModal";
import { AvatarCropConfirmModal } from "../components/AvatarCropConfirmModal";
import { FilePreviewModal } from "../components/FilePreviewModal";
// Фон по умолчанию для всех чатов (файл из public или алиас в vite.config)
import defaultChatBackground from "@default-chat-bg";

const WS_BASE = import.meta.env.VITE_WS_URL || "";

/** Эмодзи для реакций (должен совпадать с бэкендом) */
const REACTION_EMOJIS = [
  "🔥", "💫", "✨", "❤️", "🥰", "😂", "😎", "🎉", "🙌", "👏", "💪", "🤩", "🌟", "😮", "😢",
];

/** Максимальный размер файла при загрузке — 0,5 ГБ */
const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;

/** Эмодзи для вставки в текст сообщения (пикер у поля ввода) */
const INPUT_EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋",
  "😎", "🤩", "🥳", "😢", "😭", "😤", "😡", "🤔", "😶", "🙄", "❤️", "🧡", "💛", "💚", "💙",
  "💜", "🖤", "🤍", "💕", "💪", "👍", "👎", "👏", "🙌", "🤝", "🙏", "🔥", "✨", "💫", "🌟",
  "🎉", "🎊", "✅", "❌", "⚠️", "💯",
];

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

/** Сжатие изображения для экономии памяти (скрепка / нижняя зона). Качество умеренное, без сильной потери. */
async function compressImage(file: File): Promise<File> {
  // TODO: move image compression to a Web Worker to avoid UI jank on low-end devices.
  const maxDim = 1920;
  const quality = 0.82;
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w <= maxDim && h <= maxDim && file.type === "image/jpeg" && file.size < 800 * 1024) {
        resolve(file);
        return;
      }
      const scale = Math.min(maxDim / w, maxDim / h, 1);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.[a-z]+$/i, ".jpg") || "image.jpg";
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
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
function formatLastSeen(value: string | null | undefined): string {
  if (!value) return "";
  if (value === "recently") return "был(а) в сети недавно";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "был(а) в сети только что";
  if (diffMin < 60) return `был(а) в сети ${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `был(а) в сети ${diffH} ч. назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "был(а) в сети вчера";
  if (diffD < 7) return `был(а) в сети ${diffD} дн. назад`;
  return `был(а) в сети ${d.toLocaleDateString("ru-RU")}`;
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
function formatMessagePreview(msg: { msg_type?: string; content?: string; file?: { mime_type?: string } | null }): string {
  if (!msg) return "";
  const mime = (msg.file && msg.file.mime_type) || "";
  if (msg.msg_type === "video" || msg.msg_type === "video_circle" || String(mime).startsWith("video/")) return "(видео)";
  if (msg.msg_type === "audio") return "(голосовое)";
  if (String(mime).startsWith("image/")) return "(фото)";
  if (msg.msg_type === "file") return "(файл)";
  const text = (msg.content || "").trim();
  if (!text) return "(сообщение)";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

function withPreviewParams(url: string, width: number): string {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (!u.searchParams.has("w")) u.searchParams.set("w", String(width));
    if (!u.searchParams.has("preview")) u.searchParams.set("preview", "1");
    return u.toString();
  } catch {
    return url;
  }
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

export default function ChatPage({ chatId: propChatId, onBack, onChatUpdated, onChatLeft, onOpenDmWithUserId, onMessageSent }: { chatId?: string; onBack?: () => void; onChatUpdated?: (chat: Chat) => void; onChatLeft?: (chatId: string) => void; onOpenDmWithUserId?: (userId: string) => void; onMessageSent?: (chatId: string, preview: string) => void } = {}) {
  const { chatId: paramChatId } = useParams<{ chatId: string }>();
  const chatId = propChatId || paramChatId;
  const token = useAuthStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.user);
  const myUserId = currentUser?.id || "";
  const textScale = usePreferencesStore((s) => s.messageTextScale);

  const [chat, setChat] = useState<Chat | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showInfo, setShowInfo] = useState(false);
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
  const [voiceMenuPos, setVoiceMenuPos] = useState<{ x: number; y: number } | null>(null);
  /** Текущие амплитуды для визуализации во время записи (32 полоски) */
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);
  /** Уровень громкости при записи (0..255) для индикатора */
  const [voiceLevel, setVoiceLevel] = useState(0);
  /** Онлайн-статусы пользователей: userId → { is_online, last_seen_display } */
  const [onlineStatus, setOnlineStatus] = useState<Record<string, { is_online: boolean; last_seen_display?: string | null }>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [scheduledList, setScheduledList] = useState<ScheduledMessageType[]>([]);
  const [scheduleMenuPos, setScheduleMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  /** Редактирование сообщения в поле ввода (для сообщений только из эмодзи) */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [formatMenuPos, setFormatMenuPos] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
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
  const inputEditableRef = useRef<HTMLDivElement>(null);
  const savedFormatRangeRef = useRef<Range | null>(null);
  const undoStackRef = useRef<string[]>([""]);
  const undoIndexRef = useRef(0);

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
    const url = window.prompt("Введите URL:", "https://");
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

  const wsRef = useRef<WebSocket | null>(null);
  const notifWsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isScrolledToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return true;
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const scrollToMessageId = useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    (el?.previousElementSibling as HTMLElement)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setShowInfo(false);
  }, []);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const handleMessagesScroll = useCallback(() => {
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

  /* ---------- Send text (after scrollToBottom so it can be used in deps) ---------- */
  const sendTextMessage = useCallback((text: string) => {
    if (!chatId || !text.trim()) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "chat.message", msg_type: "text", content: text }));
      setInput("");
      if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
      resetUndoStack();
      return;
    }
    messagesApi.create(chatId, { msg_type: "text", content: text }).then((res) => {
      setMessages((prev) => [...prev, normalizeMessage(res.data)]);
      scrollToBottom();
      onMessageSent?.(chatId, formatMessagePreview(res.data));
    });
    setInput("");
    if (inputEditableRef.current) inputEditableRef.current.innerHTML = "";
    resetUndoStack();
  }, [chatId, resetUndoStack, scrollToBottom, onMessageSent]);

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
      const url = window.prompt("Введите URL:", "https://");
      if (url != null) applyFormatShortcut("createLink", url);
      return;
    }
    if (ctrl && e.shiftKey && e.key === "X") {
      e.preventDefault();
      applyFormatShortcut("strikeThrough");
      return;
    }
  }, [getInputMarkdown, sendTextMessage, applyFormatShortcut, setInputAndEditable, mentionPicker, mentionFiltered, insertMention]);

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
    // Also notify via notification WS
    if (notifWsRef.current?.readyState === WebSocket.OPEN) {
      notifWsRef.current.send(JSON.stringify({ type: "mark_read", chat_id: chatId }));
    }
  }, [chatId]);

  /* ---------- Reset unread state when switching chat ---------- */
  useEffect(() => {
    if (!chatId) return;
    setInitialUnreadIds([]);
    setSeenBottomIds(new Set());
    setUnreadLineDismissed(false);
    sentinelRefs.current.clear();
  }, [chatId]);

  /* ---------- Load data ---------- */
  useEffect(() => {
    if (!chatId || !token) return;
    setLoading(true);
    chatsApi.get(chatId).then((res) => {
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
    }).catch(() => setChat(null)).finally(() => setLoading(false));
    messagesApi.list(chatId).then((res) => {
      setMessages((res.data as Message[]).map(normalizeMessage));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottomInstant());
      });
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
  }, [chatId, token, scrollToBottom, scrollToBottomInstant]);

  const refreshChat = useCallback(() => {
    if (!chatId) return;
    chatsApi.get(chatId).then((res) => setChat(res.data));
  }, [chatId]);

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

  /* ---------- Close emoji picker on click outside ---------- */
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showEmojiPicker]);

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

  /* ---------- Chat WebSocket ---------- */
  useEffect(() => {
    if (!chatId || !token) return;
    const wsUrl =
      (WS_BASE ? WS_BASE.replace(/^http/, "ws") : `${window.location.origin.replace(/^http/, "ws")}`) +
      `/ws/chat/${chatId}/`;
    const ws = new WebSocket(wsUrl, ["bearer", token]);
    wsRef.current = ws;
    ws.onopen = () => {
      if (wsRef.current !== ws) ws.close();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chat.message" && data.message) {
          const raw = data.message;
          const msg: Message = normalizeMessage({
            ...raw,
            id: raw.id,
            created_at: raw.created_at || new Date().toISOString(),
            reactions: raw.reactions ?? {},
            my_reactions: raw.my_reactions ?? (raw.my_reaction ? [raw.my_reaction] : []),
            read_status: getSenderId(raw) === myUserId ? (raw.read_status || "delivered") : undefined,
          });
          const isMine = getSenderId(raw) === myUserId;
          const atBottom = isScrolledToBottom();
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (isMine) onMessageSent?.(chatId!, formatMessagePreview(raw));
          if (isMine || atBottom) setTimeout(scrollToBottom, 80);
          if (!document.hidden) markRead();
        }
        if (data.type === "chat.message.updated" && data.message) {
          const raw = data.message;
          if (raw.is_deleted) {
            setMessages((prev) => prev.filter((m) => m.id !== raw.id));
          } else {
            const updated: Message = normalizeMessage({
              ...raw,
              id: raw.id,
              created_at: raw.created_at || new Date().toISOString(),
              reactions: raw.reactions ?? {},
              my_reactions: raw.my_reactions ?? (raw.my_reaction ? [raw.my_reaction] : []),
              read_status: getSenderId(raw) === myUserId ? (raw.read_status || "delivered") : undefined,
            });
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          }
        }
        if (data.type === "chat.mark_read" && data.last_read_at) {
          const readAt = new Date(data.last_read_at).getTime();
          if (data.user_id !== myUserId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (getSenderId(m) !== myUserId) return m;
                if (new Date(m.created_at).getTime() <= readAt) {
                  return { ...m, read_status: "read" as const };
                }
                return m;
              })
            );
          }
        }
        if (data.type === "chat.typing") {
          setTyping(data.display_name || data.user_id);
          setTimeout(() => setTyping(null), 3000);
        }
        if (data.type === "user.online.status" && data.user_id) {
          setOnlineStatus((prev) => ({
            ...prev,
            [data.user_id]: { is_online: data.is_online, last_seen_display: data.last_seen_display },
          }));
        }
      } catch { /* ignore */ }
    };
    return () => {
      wsRef.current = null;
      if (ws.readyState === WebSocket.CONNECTING) return;
      ws.close();
    };
  }, [chatId, token, scrollToBottom, myUserId, markRead, isScrolledToBottom, onMessageSent]);

  /* ---------- Global notification WebSocket (for browser notifications) ---------- */
  useEffect(() => {
    if (!token) return;
    const wsUrl =
      (WS_BASE ? WS_BASE.replace(/^http/, "ws") : `${window.location.origin.replace(/^http/, "ws")}`) +
      `/ws/notifications/`;
    const ws = new WebSocket(wsUrl, ["bearer", token]);
    notifWsRef.current = ws;
    ws.onopen = () => {
      if (notifWsRef.current !== ws) ws.close();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "new_message" || data.is_muted) return;
        const inThisChat = data.chat_id === chatId;
        const tabVisible = !document.hidden;
        if (tabVisible && inThisChat) return;
        showMessageNotification(data.chat_title || "Новое сообщение", data.message || {});
      } catch { /* */ }
    };
    return () => {
      notifWsRef.current = null;
      if (ws.readyState === WebSocket.CONNECTING) return;
      ws.close();
    };
  }, [token, chatId]);

  /* ---------- Send file (REST) ---------- */
  const showFileTooBig = (name?: string) => {
    setUploadError(name ? `Файл «${name}» больше 0,5 ГБ.` : "Файл больше 0,5 ГБ.");
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
        setMessages((prev) => [...prev, normalizeMessage(msgRes.data)]);
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(msgRes.data));
      } else {
        setUploadError("Сервер вернул некорректный ответ");
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Ошибка загрузки файла";
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
        msg_type: "image",
        content: names,
        file_ids: fileIds,
      });
      if (msgRes?.data?.id) {
        setMessages((prev) => [...prev, normalizeMessage(msgRes.data)]);
        scrollToBottom();
        onMessageSent?.(chatId, formatMessagePreview(msgRes.data));
      } else {
        setUploadError("Сервер вернул некорректный ответ");
        setTimeout(() => setUploadError(""), 4000);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Ошибка загрузки файлов";
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
          setMessages((prev) => prev.map((m) => (m.id === res.data.id ? normalizeMessage(res.data) : m)));
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
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(document.createTextNode(emoji));
      r.collapse(false);
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
      setUploadError(`Файл «${tooBig.name}» больше 0,5 ГБ.`);
      setTimeout(() => setUploadError(""), 5000);
      return;
    }
    setPendingFilesForPreview(files);
    setPendingFilesAsFileOnly(zone === "top");
  };

  const sendTyping = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "chat.typing" }));
  };

  /* ---------- Mute toggle ---------- */
  const handleToggleMute = async () => {
    if (!chatId) return;
    setMuteLoading(true);
    try {
      const { data } = await chatsApi.toggleMute(chatId);
      setIsMuted(data.is_muted);
      if (chat) setChat({ ...chat, is_muted: data.is_muted });
      onChatUpdated?.({ id: chatId, is_muted: data.is_muted } as Chat);
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
      setExpandError(detail || "Не удалось расширить чат");
    } finally {
      setExpandLoading(false);
    }
  };

  /* ---------- Chat info editing ---------- */
  const handleSaveDescription = async () => {
    if (!chatId || !chat) return;
    setSavingChat(true);
    try {
      const { data: updated } = await chatsApi.update(chatId, { description: descriptionDraft });
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
      setUploadError("Файл аватара больше 0,5 ГБ.");
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
      setUploadError("Файл фона больше 0,5 ГБ.");
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

  const handleLeaveChat = () => {
    if (!chatId || !window.confirm("Вы уверены, что хотите выйти из чата?")) return;
    setLeaveLoading(true);
    setLeaveError("");
    chatsApi
      .leave(chatId)
      .then(() => { onChatLeft?.(chatId); onBack?.(); })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        setLeaveError(e?.response?.data?.detail || "Не удалось выйти из чата");
      })
      .finally(() => setLeaveLoading(false));
  };

  const handleDeleteChat = () => {
    if (!chatId || !window.confirm("Удалить чат безвозвратно? Все сообщения будут недоступны.")) return;
    setDeleteLoading(true);
    setDeleteError("");
    chatsApi
      .delete(chatId)
      .then(() => { onChatLeft?.(chatId); onBack?.(); })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        setDeleteError(e?.response?.data?.detail || "Не удалось удалить чат");
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
          setUploadError("Доступ к микрофону запрещён. Разрешите в настройках браузера.");
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
          setUploadError("Голосовое сообщение больше 0,5 ГБ.");
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
            setMessages((prev) => [...prev, normalizeMessage(msgRes.data)]);
            scrollToBottom();
            onMessageSent?.(chatId!, formatMessagePreview(msgRes.data));
          } else {
            setUploadError("Сервер вернул некорректный ответ");
            setTimeout(() => setUploadError(""), 4000);
          }
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Ошибка загрузки";
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
      setUploadError("Не удалось получить доступ к микрофону. Разрешите в настройках браузера.");
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
      setUploadError("Распознавание речи не поддерживается в этом браузере (нужен Chrome или Edge).");
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
      setUploadError(`Ошибка распознавания: ${event.error}`);
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
      setUploadError("Не удалось запустить распознавание речи.");
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

  const toggleVoiceInputMode = useCallback(() => {
    setVoiceInputMode((prev) => {
      const next = prev === "record" ? "ai" : "record";
      try {
        localStorage.setItem("chat_voice_input_mode", next);
      } catch { /* ignore */ }
      return next;
    });
    setVoiceMenuPos(null);
  }, []);

  /* ---------- Video recording ---------- */
  const MAX_VIDEO_DURATION = 60; // seconds

  const startVideoRecording = async (mode: "video" | "video_circle") => {
    try {
      if (navigator.permissions) {
        const camPerm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (camPerm.state === "denied") {
          setUploadError("Доступ к камере запрещён. Разрешите в настройках браузера.");
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
      setUploadError("Не удалось получить доступ к камере. Разрешите в настройках браузера.");
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
      <p className="text-slate-500">{loading ? "Загрузка…" : "Чат не найден."}</p>
    </div>
  );

  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "pending");
  const handleCopy = () => {
    if (!chat.invite_link) return;
    copyToClipboard(normalizeInviteLink(chat.invite_link)).then(() => { setCopiedState(true); setTimeout(() => setCopiedState(false), 2000); });
  };

  return (
    <div className="flex flex-1 min-h-0 w-full bg-slate-50 overflow-hidden">
      {/* Модалка просмотра одного изображения — затемнение + картинка по центру */}
      {singleImagePreview && (
        <SingleImageModal
          url={singleImagePreview.url}
          fileName={singleImagePreview.fileName}
          onClose={() => setSingleImagePreview(null)}
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
              title="К списку чатов"
              aria-label="К списку чатов"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <button type="button" onClick={() => setShowInfo(!showInfo)} className="flex-1 text-left hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-colors min-w-0">
            <div className="flex items-center gap-2">
              <div className="relative shrink-0">
                {(chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                  <img src={chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!} alt="" className="w-9 h-9 rounded-full object-cover" />
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
          <h1 className="font-semibold text-slate-800">{chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}</h1>
              {isMuted && (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-label="Беззвучный">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              )}
        </div>
            <p className="text-sm text-slate-500">
              {chat.is_personal && chat.other_member ? (
                typing ? (
                  <span className="text-slate-400 italic">{typing} печатает…</span>
                ) : onlineStatus[chat.other_member.id]?.is_online ? (
                  <span className="text-green-500">в сети</span>
                ) : (
                  formatLastSeen(onlineStatus[chat.other_member.id]?.last_seen_display) || "Личный"
                )
              ) : (
                (() => {
                  const onlineCount = members.filter((m) => onlineStatus[m.user.id]?.is_online && m.user.id !== myUserId).length + (onlineStatus[myUserId]?.is_online ? 1 : 0);
                  const membersLabel = `${chat.members_count} участник${chat.members_count === 1 ? "" : chat.members_count < 5 ? "а" : "ов"}`;
                  const onlineLabel = onlineCount > 0 ? ` · ${onlineCount} в сети` : "";
                  const typeLabel = chat.chat_type != null ? ` · ${chat.chat_type === "open" ? "Открытый" : "Закрытый"}` : "";
                  return membersLabel + onlineLabel + typeLabel;
                })()
              )}
            </p>
          </button>
          <button type="button" onClick={() => setShowInfo(!showInfo)} className={`p-2 rounded-lg transition-colors ${showInfo ? "bg-blue-100 text-blue-600" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`} title="Информация о чате">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
      </header>

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
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-2 flex flex-col scrollbar-hide relative z-10"
            onContextMenu={(e) => e.preventDefault()}
            onScroll={handleMessagesScroll}
          >
          <div className="flex flex-col space-y-3 min-h-0">
          {/* Закреплённые: для всех + для себя */}
          {(chat?.pinned_message || (chat?.my_pinned_messages?.length ?? 0) > 0) && (
            <div className="shrink-0 space-y-2 mb-2">
              {chat?.pinned_message && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2">
                  <p className="text-xs font-medium text-amber-800 mb-1">Закреплено для всех</p>
                  <PinnedMessagePreview
                    message={chat.pinned_message}
                    onClick={() => {
                      const el = document.querySelector(`[data-message-id="${chat!.pinned_message!.id}"]`);
                      el?.previousElementSibling?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                    }}
                  />
                </div>
              )}
              {(chat?.my_pinned_messages?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                  <p className="text-xs font-medium text-slate-600 mb-1">Закреплено для вас</p>
                  <div className="max-h-32 overflow-y-auto overflow-x-hidden scrollbar-hide space-y-1">
                    {chat!.my_pinned_messages!.map((m) => (
                      <PinnedMessagePreview
                        key={m.id}
                        message={m}
                        onClick={() => {
                          const el = document.querySelector(`[data-message-id="${m.id}"]`);
                          el?.previousElementSibling?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
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
                          {approveRejectLoading === m.id ? "…" : "Добавить"}
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
              <div className="text-center text-slate-500 text-sm max-w-[280px]">
                <p className="font-medium text-slate-600 mb-1">Здесь пока нет сообщений</p>
                <p>Напишите первое сообщение в поле ввода ниже — текст, эмодзи или отправьте файл.</p>
              </div>
            </div>
          ) : (
            (() => {
              const showUnreadLine = !unreadLineDismissed && initialUnreadIds.length > 0;
              const firstUnreadIndex = showUnreadLine
                ? messages.findIndex((m) => initialUnreadIds.includes(m.id))
                : -1;
              return messages.map((msg, i) => (
                <Fragment key={msg.id}>
                  {showUnreadLine && i === firstUnreadIndex && (
                    <div className="flex items-center gap-3 py-2">
                      <span className="flex-1 h-px bg-slate-300" aria-hidden />
                      <span className="text-xs font-medium text-slate-500 shrink-0">Непрочитанные сообщения</span>
                      <span className="flex-1 h-px bg-slate-300" aria-hidden />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isMine={getSenderId(msg) === myUserId}
                    chatId={chatId!}
                    textScale={textScale}
                    onMessageUpdated={(updated) =>
                      setMessages((prev) => prev.map((m) => (m.id === updated.id ? normalizeMessage(updated) : m)))
                    }
                    onMessageDeleted={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
                    onStartEditInInput={(id, content) => { setEditingMessageId(id); setInputAndEditable((content || "").trim()); }}
                    onImageClick={(url, fileName) => setSingleImagePreview({ url, fileName })}
                    canPinForAll={!!(chat && (chat.owner?.id === myUserId || members.some((m) => m.user.id === myUserId && m.role === "admin")))}
                    pinnedForAllMessageId={chat?.pinned_message?.id ?? null}
                    myPinnedIds={chat?.my_pinned_messages?.map((m) => m.id) ?? []}
                    onPinChange={refreshChat}
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
                </Fragment>
              ));
            })()
          )}
        <div ref={bottomRef} />
          </div>
        </div>
      {showScrollToBottom && (
        <button
          type="button"
          onClick={() => { scrollToBottom(); setShowScrollToBottom(false); }}
          className="absolute bottom-4 right-4 z-10 w-10 h-10 rounded-full bg-slate-700 text-white shadow-lg hover:bg-slate-600 flex items-center justify-center transition-colors"
          title="Вниз"
          aria-label="Прокрутить вниз"
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
                    {s.recurrence !== "none" && ` · ${s.recurrence === "daily" ? "ежедн." : "еженед."}`}
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
          <div className="border-t bg-white p-2 flex gap-2 items-center" onContextMenu={(e) => { e.preventDefault(); setScheduleMenuPos({ x: e.clientX, y: e.clientY }); }}>
            <button type="button" onClick={cancelRecording} className="text-red-500 hover:text-red-700 px-3 py-2 rounded-lg hover:bg-red-50 shrink-0" title="Отменить">
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
          <div className="relative border-t bg-white" ref={emojiPickerRef}>
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
            {showEmojiPicker && (
              <div className="scrollbar-hide absolute bottom-full right-2 left-2 sm:left-auto sm:right-2 z-50 mb-1 p-2 bg-white rounded-xl border border-slate-200 shadow-lg max-h-52 overflow-y-auto">
                <div className="grid grid-cols-8 gap-0.5">
                  {INPUT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleEmojiSelect(emoji)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors"
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
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
            <form onSubmit={handleSubmit} className="p-2 flex gap-2 items-end" onContextMenu={(e) => { e.preventDefault(); setScheduleMenuPos({ x: e.clientX, y: e.clientY }); }}>
              <label className="cursor-pointer text-slate-500 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Прикрепить файл">
                <input type="file" className="hidden" onChange={handleFile} disabled={uploading} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" multiple />
                {uploading ? (
                  <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                )}
              </label>
              <div
                ref={inputEditableRef}
                contentEditable={!uploading}
                suppressContentEditableWarning
                data-placeholder="Сообщение..."
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const sel = window.getSelection();
                  savedFormatRangeRef.current = (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null) ?? null;
                  setScheduleMenuPos(null);
                  setFormatMenuPos({ x: e.clientX, y: e.clientY, start: 0, end: 0 });
                }}
                className="flex-1 min-h-[2.5rem] max-h-[11rem] overflow-y-auto resize-none border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 scrollbar-hide empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
                style={{ height: "40px" }}
              />
            {/* Video circle button */}
            <button type="button" onClick={() => startVideoRecording("video_circle")} className="text-slate-500 hover:text-purple-500 p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Кружочек" disabled={uploading}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
            </button>
            {/* Голос: запись файла или AI-транскрипция. Правый клик — переключить режим. */}
            <button
              type="button"
              onClick={toggleVoiceInput}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setVoiceMenuPos({ x: e.clientX, y: e.clientY });
              }}
              className={`p-2 rounded-lg transition-colors ${voiceInputMode === "ai" ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50" : "text-slate-500 hover:text-red-500 hover:bg-slate-100"} ${aiListening ? "bg-blue-100 text-blue-700" : ""}`}
              title={voiceInputMode === "ai" ? (aiListening ? "Остановить диктовку" : "AI-голосовой ввод (транскрипция в поле)") : "Голосовое сообщение (правый клик — переключить на AI-ввод)"}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </button>
            {input.trim() && (
              <button
                type="submit"
                className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
                disabled={uploading}
                title="Enter — отправить, Shift+Enter — новая строка"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
            )}
            </form>
          </div>
        )}

        {/* Context menu: запланировать сообщение */}
        {scheduleMenuPos && (
          <div
            className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[180px]"
            style={{ left: scheduleMenuPos.x, top: scheduleMenuPos.y }}
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
          </div>
        )}

        {/* Context menu: переключение режима голоса (правый клик по кнопке микрофона) */}
        {voiceMenuPos && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden onClick={() => setVoiceMenuPos(null)} />
            <div
              className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[220px]"
              style={{ left: voiceMenuPos.x, top: voiceMenuPos.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                onClick={toggleVoiceInputMode}
              >
                {voiceInputMode === "record" ? (
                  <>
                    <span className="text-blue-500">♪</span>
                    Переключить на AI-голосовой ввод (транскрипция в поле)
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                    Переключить на запись голосового сообщения
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* Context menu: Markdown-форматирование (правый клик по полю ввода) — не выходит за границы чата */}
        {formatMenuPos && (() => {
          const MENU_W = 220;
          const MENU_H = 280;
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
                <button type="button" onClick={() => setEditingAvatar(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100" aria-label="Закрыть">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <div className="px-6 pb-2 flex flex-col items-center">
                {chat.avatar_url ? (
                  <img src={chat.avatar_url} alt="Фото чата" className="w-48 h-48 rounded-2xl object-cover mb-6" />
                ) : (
                  <div className="w-48 h-48 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button type="button" onClick={() => { handleRemoveAvatar(); setEditingAvatar(false); }} disabled={avatarUploading || !chat.avatar_url} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200 disabled:opacity-50 disabled:pointer-events-none text-sm font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    Удалить
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingAvatar(false); setShowAvatarEditor(true); }}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                    title="Обрезать, рисовать, писать текст"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    Редактировать
                  </button>
                  <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm font-medium col-span-2">
                    {avatarUploading ? <span>Загрузка...</span> : (<><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Заменить</>)}
                  </button>
                  {/* TODO: Генерация аватарки чата с помощью ИИ — интеграция с API, выбор стиля/промпта, загрузка результата как аватар */}
                  <button
                    type="button"
                    onClick={() => alert("Функционал в разработке")}
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
            imageUrl={chat.avatar_url ?? null}
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
            aria-label="Закрыть"
          >
            <img
              src={showAvatarFullscreen}
              alt="Полное фото"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setShowAvatarFullscreen(null)}
              className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full hover:bg-white/10"
              aria-label="Закрыть"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Info sidebar */}
      {showInfo && (
        <aside className="w-80 border-l bg-white flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-800">О чате</h2>
              <div className="flex items-center gap-1">
                <div className="relative" ref={infoMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowInfoMenu((v) => !v)}
                    className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label="Меню"
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
                            title={amIOnlyAdmin ? "Сначала назначьте другого администратора" : undefined}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                            Выйти из чата
                          </button>
                        )}
                        <button type="button" onClick={() => { handleToggleMute(); setShowInfoMenu(false); }} disabled={muteLoading} className={btnCls}>
                          {isMuted ? (
                            <><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>Включить уведомления</>
                          ) : (
                            <><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>Выключить уведомления</>
                          )}
                        </button>
                        {chat.owner?.id === myUserId && (
                          <button type="button" onClick={() => { handleDeleteChat(); setShowInfoMenu(false); }} disabled={deleteLoading} className={btnClsRed}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Удалить чат
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
                </div>
                <button type="button" onClick={() => setShowInfo(false)} className="text-slate-400 hover:text-slate-600 p-1">&#10005;</button>
              </div>
            </div>

            {(leaveError || deleteError) && (
              <div className="px-4 py-2 border-b bg-red-50 border-red-100">
                <p className="text-xs text-red-600">{leaveError || deleteError}</p>
              </div>
            )}

            {/* Avatar */}
            <div className="flex flex-col items-center mb-3">
              <div className="relative group">
                {(chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                  <button
                    type="button"
                    onClick={() => setShowAvatarFullscreen(chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!)}
                    className="block rounded-full overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    title="Просмотреть фото"
                  >
                    <img src={chat.is_personal && chat.other_member ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)! : chat.avatar_url!} alt="" className="w-20 h-20 rounded-full object-cover" />
                  </button>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
                    {chat.is_personal && chat.other_member
                      ? (chat.other_member.display_name || chat.other_member.phone || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?"
                      : (chat.title || "Ч").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "Ч"}
                  </div>
                )}
                {chat.owner?.id === myUserId && !chat.is_personal && (
                  <button type="button" onClick={() => setEditingAvatar(true)} className="absolute bottom-0 right-0 w-7 h-7 bg-slate-600 text-white rounded-full flex items-center justify-center shadow hover:bg-slate-700 transition-colors" title="Изменить фото">
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
                    placeholder="Название чата"
                  />
                  {titleDraft.length >= 30 && (
                    <p className="text-xs text-slate-500 text-center">{titleDraft.length}/50</p>
                  )}
                  <div className="flex gap-2 justify-center">
                    <button type="button" onClick={() => { setEditingTitle(false); setTitleDraft(chat.title || ""); }} className="text-xs text-slate-500 hover:text-slate-700">Отмена</button>
                    <button type="button" onClick={handleSaveTitle} disabled={savingChat || !titleDraft.trim()} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">{savingChat ? "..." : "Сохранить"}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 mt-2">
                  <h3 className="font-semibold text-slate-800 text-center">{chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}</h3>
                  {chat.owner?.id === myUserId && !chat.is_personal && (
                    <button type="button" onClick={() => { setTitleDraft(chat.title || ""); setEditingTitle(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 rounded" title="Изменить название">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                  )}
                </div>
              )}
              {chat.is_personal && chat.other_member && (
                <p className="text-xs mt-0.5">
                  {onlineStatus[chat.other_member.id]?.is_online ? (
                    <span className="text-green-500 font-medium">в сети</span>
                  ) : (
                    <span className="text-slate-500">{formatLastSeen(onlineStatus[chat.other_member.id]?.last_seen_display)}</span>
                  )}
                </p>
              )}
              {!chat.is_personal && (
                <p className="text-xs text-slate-500">{chat.members_count} участник{chat.members_count === 1 ? "" : chat.members_count < 5 ? "а" : "ов"}</p>
              )}
              {/* Group tier badge + возраст группы — только для групп */}
              {!chat.is_personal && (() => {
                const eff = chat.effective_max_members ?? chat.max_members ?? 100;
                const tier = eff >= 10000 ? "mega" : eff >= 1000 ? "kilo" : "default";
                const label = tier === "mega" ? "Мега группа" : tier === "kilo" ? "Кило группа" : "Группа";
                const hint = tier === "mega" ? "До 10 000 участников" : tier === "kilo" ? "До 1 000 участников" : "До 100 участников";
                const colors = tier === "mega" ? "bg-purple-100 text-purple-700" : tier === "kilo" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
                const created = new Date(chat.created_at).getTime();
                const days = Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
                const ageStr = days < 31
                  ? (days === 0 ? "менее дня" : days === 1 ? "1 день" : days < 5 ? `${days} дня` : `${days} дн.`)
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

            {/* В личном чате описание не показываем; юзернейм и номер телефона. В группе — блок «Описание». */}
            {chat.is_personal && chat.other_member && (
              <div className="mb-3 space-y-1">
                {chat.other_member.username && (
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-400">Юзернейм: </span>
                    {onOpenDmWithUserId && chat.other_member?.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUsernameShake(true);
                          setTimeout(() => setUsernameShake(false), 400);
                        }}
                        className={`font-medium text-blue-600 hover:text-blue-800 hover:underline inline-block ${usernameShake ? "animate-username-shake" : ""}`}
                        title="Вы уже в этом чате"
                      >
                        @{chat.other_member.username}
                      </button>
                    ) : (
                      <span className="font-medium">@{chat.other_member.username}</span>
                    )}
                  </p>
                )}
                {chat.other_member.phone && (
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-400">Номер: </span>
                    <span className="font-medium text-slate-800">{chat.other_member.phone}</span>
                  </p>
                )}
              </div>
            )}
{!chat.is_personal && (
            <div className="mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Описание</span>
                  {chat.owner?.id === myUserId && !editingDescription && (
                    <button type="button" onClick={() => { setDescriptionDraft(chat.description || ""); setEditingDescription(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 rounded" title="Изменить описание">
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
                      onChange={(e) => setDescriptionDraft(e.target.value.slice(0, 300))}
                      maxLength={300}
                      autoFocus
                      placeholder="Добавьте описание группы..."
                    />
                    <p className="text-xs text-slate-500 text-right mt-0.5">{descriptionDraft.length}/300</p>
                    <div className="flex gap-2 mt-1 justify-end">
                      <button type="button" onClick={() => setEditingDescription(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Отмена</button>
                      <button type="button" onClick={handleSaveDescription} disabled={savingChat} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">{savingChat ? "..." : "Сохранить"}</button>
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
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{chat.description}</p>
                        ) : (
                          <p className="text-sm text-slate-400 italic">Нет описания</p>
                        )}
                      </button>
                    ) : (
                      <>
                        {chat.description ? (
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{chat.description}</p>
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
            {!chat.is_personal && (
            <div className="space-y-2">
              {chat.chat_type != null && (
              <div><span className="text-xs text-slate-400 uppercase tracking-wide">Тип</span><p className="text-slate-700">{chat.chat_type === "open" ? "Открытый" : "Закрытый"}</p></div>
              )}
              {chat.invite_link && (
                <div>
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Пригласительная ссылка</span>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-slate-100 rounded px-2 py-1 text-slate-600 truncate flex-1">{normalizeInviteLink(chat.invite_link)}</code>
                    <button type="button" onClick={handleCopy} className={`text-xs px-2 py-1 rounded transition-colors ${copiedState ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}>{copiedState ? "Скопировано" : "Копировать"}</button>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>

          {/* Расширение за звёзды — только для групп; в личном чате не показываем */}
          {!chat.is_personal && chat.owner?.id === myUserId && (() => {
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
                      {expandLoading ? "..." : "Прокачать за ⭐ 100 звёзд"}
                    </button>
                  </div>
                )}
                {isExpandedTo100 && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800 font-medium">&#9733; Чат расширен до 100 участников навсегда</p>
                  </div>
                )}
                {isExpandedTo1000 && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800 font-medium">&#9733; Чат расширен до 1000 участников навсегда</p>
                  </div>
                )}
                {expandError && <p className="text-xs text-red-500">{expandError}</p>}
                {/* Подсказка: при нехватке звёзд — поделиться реферальной ссылкой */}
                {(expandError?.includes("Недостаточно звёзд") || showUpgradeTo1000) && (
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
              const tabs: { id: "media" | "links" | "files" | "participants"; label: string }[] = isGroup
                ? [
                    { id: "participants" as const, label: "Участники" },
                    { id: "media", label: "Медиа" },
                    { id: "links", label: "Ссылки" },
                    { id: "files", label: "Файлы" },
                  ]
                : [
                    { id: "media", label: "Медиа" },
                    { id: "links", label: "Ссылки" },
                    { id: "files", label: "Файлы" },
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
                    {mediaLinksFilesTab === "participants" && isGroup && (
                      <div className="space-y-4">
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
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${m.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{m.role === "admin" ? "Админ" : "Участник"}</span>
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
                                        {approveRejectLoading === m.id ? "…" : "Добавить"}
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
                    {(mediaLinksFilesTab === "media" || (mediaLinksFilesTab === "participants" && !isGroup)) && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {mediaMessages.slice(-24).reverse().map((msg) => {
                          const url = thumbUrl(msg);
                          const isImg = isImage(msg);
                          return (
                          <button key={msg.id} type="button" onClick={() => scrollToMessageId(msg.id)} className="aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-400">
                            {isImg && url ? (
                              <img src={url} alt="" className="w-full h-full object-cover" />
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
                        {linkMessages.length === 0 && <p className="text-xs text-slate-500">Нет ссылок</p>}
                      </ul>
                    )}
                    {mediaLinksFilesTab === "files" && (
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {fileMessages.slice(-20).reverse().map((msg) => {
                          const name = (msg.file && typeof msg.file === "object" && "original_name" in msg.file) ? (msg.file as { original_name?: string }).original_name : msg.content || "Файл";
                          return (
                            <li key={msg.id}>
                              <button type="button" onClick={() => scrollToMessageId(msg.id)} className="w-full text-left text-sm text-slate-700 hover:bg-slate-50 truncate block px-2 py-1.5 rounded flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span className="truncate">{name}</span>
                              </button>
                            </li>
                          );
                        })}
                        {fileMessages.length === 0 && <p className="text-xs text-slate-500">Нет файлов</p>}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}

          </div>
        </aside>
      )}
    </div>
  );
}

/* ================================================================
   UpgradeTo100Compact — компактный блок: до 100 участников + реферальная ссылка + кнопка Личный кабинет
   ================================================================ */
function UpgradeTo100Compact() {
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
          title: "Присоединяйся к чатам",
          text: "Зарегистрируйся по моей ссылке — месяц бесплатно и ⭐ 10 звёзд в подарок.",
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
        &#9733; Сейчас в группе до 10 участников. Чтобы расширить до 100, накопите 50 звёзд в реферальной программе.
      </p>
      <Link
        to="/dashboard"
        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm hover:shadow transition-all focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-amber-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Личный кабинет
      </Link>
      <div className="flex items-center gap-2 pt-1 border-t border-amber-200/60">
        <p className="text-xs text-amber-700 flex-1 min-w-0 truncate">Приглашайте друзей — за каждого &#9733; 10 звёзд</p>
        {referralLink && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-200/80 transition-colors"
              title="Копировать ссылку"
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
              title="Поделиться"
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
          title: "Присоединяйся к чатам",
          text: "Зарегистрируйся по моей ссылке — месяц бесплатно и ⭐ 10 звёзд в подарок.",
          url: referralLink,
        });
      } catch { /* user cancelled or error */ }
    } else {
      handleCopy();
    }
  };

  if (!referralLink) return <p className="text-xs text-slate-500">Загрузка…</p>;

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
            title="Копировать ссылку"
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
            title="Поделиться"
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

const SHORT_MSG_MAX_LEN = 50;

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

/** Краткий превью закреплённого сообщения (клик — переход к сообщению) */
function PinnedMessagePreview({ message, onClick }: { message: Message; onClick: () => void }) {
  const isFile = message.msg_type !== "text" && message.msg_type !== "emoji";
  const preview = isFile ? "(файл)" : (message.content || "").trim().slice(0, 80);
  const sender = (message.sender as User)?.display_name || (message.sender as User)?.phone || "";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left text-sm text-slate-700 hover:bg-white/60 rounded-lg px-2 py-1.5 truncate"
    >
      {sender && <span className="font-medium text-slate-600">{sender}: </span>}
      <span className="truncate">{preview}</span>
    </button>
  );
}

function SingleImageModal({ url, fileName, onClose }: { url: string; fileName?: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div className="max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={fileName || ""} className="max-w-full max-h-[85vh] w-auto h-auto object-contain rounded-lg shadow-2xl" />
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="fixed top-4 right-4 z-[111] bg-white/90 hover:bg-white text-slate-800 rounded-full w-9 h-9 flex items-center justify-center shadow-lg transition-colors"
        aria-label="Закрыть"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
  chatId,
  textScale,
  onMessageUpdated,
  onMessageDeleted,
  onStartEditInInput,
  onImageClick,
  canPinForAll,
  pinnedForAllMessageId,
  myPinnedIds,
  onPinChange,
}: {
  message: Message;
  isMine: boolean;
  chatId: string;
  textScale: number;
  onMessageUpdated: (msg: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  /** Для сообщений только из эмодзи — редактировать в поле ввода, а не инлайном */
  onStartEditInInput?: (messageId: string, content: string) => void;
  /** Клик по одиночному изображению — открыть в модалке вместо новой вкладки */
  onImageClick?: (url: string, fileName?: string) => void;
  /** Может ли текущий пользователь закрепить сообщение для всех (админ/владелец) */
  canPinForAll?: boolean;
  /** ID сообщения, закреплённого для всех в чате */
  pinnedForAllMessageId?: string | null;
  /** ID сообщений, закреплённых текущим пользователем для себя */
  myPinnedIds?: string[];
  /** Вызов после закрепления/открепления (обновить чат) */
  onPinChange?: () => void;
}) {
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

  useEffect(() => () => {
    if (reactionLimitToastTimerRef.current) clearTimeout(reactionLimitToastTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
  }, []);

  const isFile = message.msg_type !== "text" && message.msg_type !== "emoji";
  const senderName = getSenderName(message);
  const content = message.content || "(файл)";
  const isShortText = !isFile && content.length <= SHORT_MSG_MAX_LEN && !content.includes("\n");
  const isEmojiOnly = !isFile && !content.includes("\n") && isOnlyEmoji(content);
  const reactions = message.reactions ?? {};
  const myReactions: string[] = message.my_reactions ?? [];
  const canEdit = isMine && !isFile && message.msg_type === "text";
  const canAddReaction = myReactions.length < 3;

  const fileUrl = message.file ? ((message.file as { url?: string }).url || "#") : "#";
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
  const filePreviewUrl = fileUrl && isImage ? withPreviewParams(fileUrl, 900) : fileUrl;
  const isAudio = message.msg_type === "audio" || (message.file && (message.file as { mime_type?: string }).mime_type?.startsWith("audio/"));
  const isVideo = message.file && (message.msg_type === "video" || fileIsVideo);
  const isVideoCircle = message.msg_type === "video_circle" && message.file;

  // Несколько изображений — плитка; учитываем mime и расширение
  const allFiles = (message.files ?? []).filter((f) => f != null && typeof f === "object" && "id" in f) as Message["files"];
  const imageFiles = allFiles.filter((f) => (f.mime_type || "").startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(f.original_name || ""));
  const isMultiImage = imageFiles.length > 1;
  const isImageBubble = isVideoCircle || isMultiImage || (isFile && isImage);

  const timeStr = new Date(message.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  const editedStr = message.edited_at
    ? new Date(message.edited_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })
    : null;
  const readStatus = isMine ? (message.read_status || "delivered") : null;
  const Checkmarks = readStatus === "read" ? (
    <span className="ml-1 inline-flex" title="Прочитано">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 -ml-0.5"><path d="M20 6 9 17l-5-5"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 -ml-1.5"><path d="M20 6 9 17l-5-5"/></svg>
    </span>
  ) : readStatus === "delivered" ? (
    <span className="ml-1 inline-flex" title="Доставлено">
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
      onMessageUpdated(normalizeMessage(res.data));
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

  const handleDelete = () => {
    closeContextMenu();
    messagesApi.delete(chatId, message.id).then(() => {
      onMessageDeleted?.(message.id);
    });
  };

  const hasReactions = Object.keys(reactions).length > 0;
  const reactionEntries = Object.entries(reactions).filter(([, c]) => c > 0);

  const reactionButtons = hasReactions ? (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
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
          title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : "Макс. 3 реакции"}
        >
          <span>{emoji}</span>
          {count > 1 && <span className="ml-0.5 tabular-nums">{count}</span>}
        </button>
      ))}
    </span>
  ) : null;

  /** Время (+ ред.) + галочки; реакции у своих — слева от пузыря, у входящих — справа от пузыря (отдельный блок) */
  const timeEl = (
    <span className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0 text-[10px] max-w-full min-w-0 shrink-0 ${isMine ? "text-slate-500" : "text-slate-400"}`}>
      {timeStr}
      {editedStr && <span className="opacity-80 ml-0.5">ред. {editedStr}</span>}
      {Checkmarks}
    </span>
  );

  const handleMouseEnter = () => {
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
    hoverDelayTimerRef.current = setTimeout(() => setHoverDelayPassed(true), 1000);
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
      className={`flex ${isMine ? "justify-end" : "justify-start"} group ${hasReactions ? "mb-1" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const menuWidth = 200;
        const menuHeight = 180;
        const pad = 8;
        const x = Math.max(pad, Math.min(e.clientX, window.innerWidth - menuWidth - pad));
        const y = Math.max(pad, Math.min(e.clientY, window.innerHeight - menuHeight - pad));
        setContextMenu({ x, y });
      }}
    >
      {/* Обёртка: [аватар + пузырь + реакции внизу] */}
      <div className={`relative inline-flex flex-row flex-nowrap items-end gap-2.5 ${isMine ? "" : ""}`}>
        {/* Reaction picker — слева от сообщения (с другой стороны от аватарки), не перекрывая пузырь */}
        {isMine && hoverDelayPassed && !editing && (
          <div
            className="absolute bottom-1 right-full mr-0.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
          >
            <div className="scrollbar-hide flex flex-col gap-0.5 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-lg py-1 px-1 overflow-y-auto max-h-[5.75rem]">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={reactionLoading || (!myReactions.includes(emoji) && !canAddReaction)}
                  onClick={() => handleReaction(emoji)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors shrink-0 ${myReactions.includes(emoji) ? "bg-blue-100 ring-1 ring-blue-300" : ""}`}
                  title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : "Макс. 3 реакции"}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

      <div className={`relative inline-flex flex-row items-end gap-2 max-w-[88%] min-w-0 shrink-0 ${isMine ? "order-2 flex-row-reverse" : "order-0"}`}>
        {(() => {
          const sender = message.sender as User;
          const avatarUrl = sender?.avatar_url ?? sender?.avatar ?? null;
          return (
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden bg-slate-200">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-slate-600">
                  {getAvatarInitials(senderName)}
                </span>
              )}
            </div>
          );
        })()}
        <div className={`flex flex-col min-w-0 ${isMine ? "items-end" : "items-start"}`}>
        {isEmojiOnly && !editing ? (
          <div className={`inline-flex flex-col gap-0.5 max-w-full min-w-0 rounded-2xl ${content.length <= 20 ? "px-6 py-3" : "px-3 py-1.5"} ${isMine ? "bg-blue-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"}`} style={{ fontSize: `${MESSAGE_EMOJI_BASE_PX * textScale}px` }}>
            <div className="inline-flex items-center gap-2 flex-wrap">
              <span className="leading-none">{content.trim()}</span>
              {timeEl}
            </div>
            {hasReactions && (
              <div className={`flex flex-wrap gap-x-1 gap-y-0.5 mt-0.5 animate-reactions-appear ${isMine ? "justify-end" : "justify-start"}`}>
                {reactionButtons}
              </div>
            )}
          </div>
        ) : (
        <div className={`inline-block max-w-full min-w-0 ${isImageBubble ? "rounded-2xl p-0 overflow-visible" : "overflow-hidden"} ${isImageBubble ? "rounded-2xl p-0" : isMultiImage ? `rounded-2xl pl-2 pr-2 pt-1.5 pb-1.5 ${isMine ? "bg-blue-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"}` : `rounded-2xl ${content.length <= 20 ? "px-6 py-3" : "px-3 py-1.5"} ${isMine ? "bg-blue-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"}`}`} style={{ fontSize: `${MESSAGE_TEXT_BASE_PX * textScale}px` }}>
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
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
                {isMine ? (<> {hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}{timeEl}</>) : (<> {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}</>)}
              </div>
            </div>
          ) : isVideo ? (
            <div className="min-w-0 max-w-full">
              <video controls src={fileUrl} className="max-w-[300px] max-h-80 rounded-lg" preload="metadata" />
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
                {isMine ? (<> {hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}{timeEl}</>) : (<> {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}</>)}
              </div>
            </div>
          ) : isMultiImage ? (
            <div className="min-w-0 max-w-full">
              <ImageTileGrid images={imageFiles} />
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
                {isMine ? (<> {hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}{timeEl}</>) : (<> {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}</>)}
              </div>
            </div>
          ) : isFile && message.file ? (
            <div className="min-w-0 max-w-full overflow-hidden rounded-lg">
              {isImage ? (
                onImageClick ? (
                  <button type="button" onClick={() => onImageClick(fileUrl, fileName)} className="block min-w-0 max-w-full text-left">
                    <img src={filePreviewUrl} alt={fileName} className="max-w-[300px] max-h-80 w-full h-auto object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity" loading="lazy" decoding="async" />
                  </button>
                ) : (
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="block min-w-0 max-w-full">
                    <img src={filePreviewUrl} alt={fileName} className="max-w-[300px] max-h-80 w-full h-auto object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity" loading="lazy" decoding="async" />
                  </a>
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
              <div className={`mt-0 min-w-0 max-w-full flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
                {isMine ? (<> {hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}{timeEl}</>) : (<> {timeEl}{hasReactions && <span className="animate-reactions-appear">{reactionButtons}</span>}</>)}
              </div>
            </div>
          ) : isShortText ? (
            <>
              <div className={`flex items-center gap-x-1.5 gap-y-0 leading-snug min-w-0 max-w-full ${content.length < 20 ? "flex-nowrap" : "flex-wrap"} ${isMine ? "justify-end" : ""}`}>
                <MarkdownMessageContent content={content} isMine={isMine} className="inline" inline />
                {timeEl}
              </div>
              {hasReactions && (
                <div className={`flex flex-wrap gap-x-1 gap-y-0.5 mt-0.5 animate-reactions-appear ${isMine ? "justify-end" : "justify-start"}`}>
                  {reactionButtons}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={`flex flex-wrap items-center gap-x-1.5 leading-snug min-w-0 max-w-full ${isMine ? "justify-end" : ""}`}>
                <MarkdownMessageContent content={content} isMine={isMine} className="inline" />
                {timeEl}
              </div>
              {hasReactions && (
                <div className={`flex flex-wrap gap-x-1 gap-y-0.5 mt-0.5 animate-reactions-appear ${isMine ? "justify-end" : "justify-start"}`}>
                  {reactionButtons}
                </div>
              )}
            </>
          )}
        </div>
        )}
        </div>
      </div>

        {/* Reaction picker — справа от сообщения (с другой стороны от аватарки), не перекрывая пузырь */}
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
                  title={myReactions.includes(emoji) ? `Снять ${emoji}` : canAddReaction ? emoji : "Макс. 3 реакции"}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[200px] py-1 bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col max-h-[70vh]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
            onClick={() => {
              const text = isFile ? "(файл)" : (message.content || "");
              copyToClipboard(text).then(() => {
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            {contextMenuCopied ? "Скопировано" : "Копировать"}
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
            onClick={() => {
              const raw = isFile ? "(файл)" : (message.content || "");
              const text = isFile ? raw : stripMarkdown(raw);
              copyToClipboard(text).then(() => {
                setContextMenuCopied(true);
                setTimeout(() => setContextMenuCopied(false), 2000);
              });
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Копировать для Word
          </button>
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
              Редактировать сообщение
            </button>
          )}
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
          {(() => {
            const isPinnedByMe = (myPinnedIds ?? []).includes(message.id);
            const isPinnedForAll = pinnedForAllMessageId === message.id;
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
                {canPinForAll && !isPinnedForAll && (
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
                        <img src={(u.avatar_url ?? u.avatar)!} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
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
      )}
      {reactionLimitToast && createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[500] px-4 py-2.5 bg-slate-800 text-white text-sm rounded-lg shadow-lg whitespace-nowrap animate-in fade-in duration-200" role="alert">
          Максимум 3 реакции от одного пользователя
        </div>,
        document.body
      )}
    </div>
  );
}

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
    <div className="flex items-center gap-2 my-0.5">
      <audio ref={audioRef} src={fileUrl} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isMine ? "bg-blue-200 hover:bg-blue-300 text-slate-800" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
        }`}
        aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          role="progressbar"
          aria-valuenow={progress * 100}
          className={`h-1.5 w-full rounded-full overflow-hidden cursor-pointer ${isMine ? "bg-blue-200/80" : "bg-slate-200"}`}
          onClick={handleBarClick}
        >
          <div
            className={`h-full rounded-full transition-all ${isMine ? "bg-slate-600" : "bg-blue-600"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className={`text-xs ${isMine ? "text-slate-600" : "text-slate-500"}`}>
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
  if (!waveform.length) return null;
  const maxH = 20;
  const n = waveform.length;
  const playedCls = isMine ? "bg-slate-600" : "bg-blue-600";
  const unplayedCls = isMine ? "bg-blue-200/80" : "bg-slate-300";

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
      aria-label={onSeek ? "Перемотка: клик по волне" : undefined}
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
    <div className="flex items-center gap-2 my-0.5">
      <audio ref={audioRef} src={fileUrl} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isMine ? "bg-blue-200 hover:bg-blue-300 text-slate-800" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
        }`}
        aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <AudioWaveform waveform={waveform} isMine={isMine} progress={progress} onSeek={handleSeek} />
        <div className={`text-xs ${isMine ? "text-slate-600" : "text-slate-500"}`}>
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ImageTileGrid — плиточное отображение нескольких изображений
   ================================================================ */

function ImageTileGrid({ images }: { images: { id: string; url?: string | null; original_name?: string }[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const count = images.length;

  // Определяем сетку в зависимости от количества
  const getGridClass = () => {
    if (count === 2) return "grid-cols-2";
    if (count === 3) return "grid-cols-2";
    if (count === 4) return "grid-cols-2";
    if (count >= 5) return "grid-cols-3";
    return "grid-cols-1";
  };

  // Для 3 картинок: первая занимает всю ширину
  const getItemClass = (idx: number) => {
    if (count === 3 && idx === 0) return "col-span-2";
    return "";
  };

  const getItemHeight = () => {
    if (count === 2) return "h-40";
    if (count <= 4) return "h-32";
    return "h-28";
  };

  // Показывать максимум 6, остальные — "+N"
  const maxShow = 6;
  const visibleImages = images.slice(0, maxShow);
  const hiddenCount = count - maxShow;

  return (
    <>
      <div className={`grid ${getGridClass()} gap-0.5 rounded-xl overflow-hidden max-w-[320px]`}>
        {visibleImages.map((img, idx) => {
          const url = img.url || "#";
          const previewUrl = withPreviewParams(url, 520);
          const isLast = idx === maxShow - 1 && hiddenCount > 0;
          return (
            <div
              key={img.id}
              className={`relative ${getItemClass(idx)} ${getItemHeight()} cursor-pointer overflow-hidden`}
              onClick={() => setLightboxIdx(idx)}
            >
              <img
                src={previewUrl}
                alt={img.original_name || ""}
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                loading="lazy"
                decoding="async"
              />
              {isLast && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="text-white text-2xl font-bold">+{hiddenCount}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
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
  const [idx, setIdx] = useState(initialIndex);
  const img = images[idx];
  const url = img?.url || "#";

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
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={img?.original_name || ""} className="max-w-full max-h-[85vh] object-contain rounded-lg" />

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
        aria-label="Закрыть"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

function VideoCirclePlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setDuration(el.duration);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

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
        className="relative w-48 h-48 rounded-full overflow-hidden cursor-pointer group bg-black"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-cover"
          preload="metadata"
          playsInline
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

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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
  const [content, setContent] = useState(initialContent);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [recurrenceTime, setRecurrenceTime] = useState("09:00");
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
      setError("Введите текст сообщения.");
      return;
    }
    if (!scheduledAt) {
      setError("Укажите дату и время отправки.");
      return;
    }
    const at = new Date(scheduledAt);
    if (at.getTime() <= Date.now()) {
      setError("Время отправки должно быть в будущем.");
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
        const msg = err.response?.data?.detail || err.response?.data?.recurrence_time?.[0] || err.response?.data?.recurrence_weekday?.[0] || "Ошибка сохранения.";
        setError(msg);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Отложенное сообщение</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">&#10005;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Текст</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[80px]"
              placeholder="Сообщение..."
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Когда отправить</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Повтор</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as "none" | "daily" | "weekly")}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="none">Один раз</option>
              <option value="daily">Каждый день</option>
              <option value="weekly">Раз в неделю</option>
            </select>
          </div>
          {recurrence !== "none" && (
            <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">Время</label>
              <input
                type="time"
                value={recurrenceTime}
                onChange={(e) => setRecurrenceTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            {recurrence === "weekly" && (
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">День недели</label>
                <select
                  value={recurrenceWeekday}
                  onChange={(e) => setRecurrenceWeekday(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {WEEKDAYS.map((label, i) => (
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
              Отмена
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {submitting ? "Сохранение…" : "Запланировать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
