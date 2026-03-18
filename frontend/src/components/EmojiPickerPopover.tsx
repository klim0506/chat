import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { EMOJI_SHORTCODES } from "../data/emoji-shortcodes";

/** Unique emojis for picker: empty + popular + shortcodes (deduplicated). */
const PICKER_EMOJIS = (() => {
  const popular = ["", "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😎", "🤩", "🥳", "😢", "😭", "😤", "😡", "🤔", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💪", "👍", "👎", "👏", "🙌", "🤝", "🙏", "🔥", "✨", "💫", "🌟", "🎉", "🎊", "✅", "❌", "⚠️", "💯", "📢", "🎯", "💬", "📱", "💡", "🎬", "🏠", "📎", "🔒"];
  const fromShortcodes = [...new Set(EMOJI_SHORTCODES.map((s) => s.emoji))];
  const seen = new Set<string>(popular);
  for (const e of fromShortcodes) {
    if (!seen.has(e)) {
      popular.push(e);
      seen.add(e);
    }
  }
  return popular;
})();

interface EmojiPickerPopoverProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Trigger element — click opens popover */
  children: React.ReactNode;
  /** Optional class for the trigger wrapper */
  className?: string;
  /** Title for "no emoji" option */
  emptyLabel?: string;
}

const POPOVER_OFFSET = 4;

/** Popover with full emoji grid; use for channel title icon or profile status. Renders in a portal so it is not clipped by overflow. */
export function EmojiPickerPopover({ value, onChange, children, className = "", emptyLabel = "Без иконки" }: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + POPOVER_OFFSET,
        left: rect.left,
      });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setPosition(null);
  }, [open]);

  const popoverContent =
    open &&
    position &&
    (
    <div
      ref={popoverRef}
      className="fixed z-[200] p-2 bg-white rounded-xl border border-slate-200 shadow-lg max-h-64 overflow-y-auto"
      style={{ top: position.top, left: position.left }}
    >
      <div className="grid grid-cols-8 gap-1">
        <button
          type="button"
          onClick={() => { onChange(""); setOpen(false); }}
          title={emptyLabel}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
            !value ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
          }`}
        >
          −
        </button>
        {PICKER_EMOJIS.filter(Boolean).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => { onChange(emoji); setOpen(false); }}
            title={emoji}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
              value === emoji ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div ref={triggerRef} className={`relative ${className}`}>
        <div onClick={() => setOpen((v) => !v)}>{children}</div>
      </div>
      {typeof document !== "undefined" && popoverContent && createPortal(popoverContent, document.body)}
    </>
  );
}
