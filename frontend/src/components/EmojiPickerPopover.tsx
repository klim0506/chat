import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TELEGRAM_EMOJI_CATEGORIES } from "../data/telegram-emojis";
import { EmojiGlyph } from "./EmojiGlyph";

interface EmojiPickerPopoverProps {
  value: string;
  onChange: (emoji: string) => void;
  children: React.ReactNode;
  className?: string;
  emptyLabel?: string;
}

const POPOVER_OFFSET = 4;

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
      setPosition({ top: rect.bottom + POPOVER_OFFSET, left: rect.left });
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
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(timer);
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
        className="fixed z-[200] max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        style={{ top: position.top, left: position.left, width: 320 }}
      >
        <div className="space-y-3">
          <section>
            <div className="mb-1 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Options
            </div>
            <div className="grid grid-cols-8 gap-1">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                title={emptyLabel}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors ${
                  !value ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                -
              </button>
            </div>
          </section>
          {TELEGRAM_EMOJI_CATEGORIES.map((category) => (
            <section key={category.id}>
              <div className="sticky top-0 z-[1] mb-1 bg-white/95 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400 backdrop-blur">
                {category.label}
              </div>
              <div className="grid grid-cols-8 gap-1">
                {category.items.map((item) => (
                  <button
                    key={item.src}
                    type="button"
                    onClick={() => { onChange(item.emoji); setOpen(false); }}
                    title={item.emoji}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      value === item.emoji ? "bg-blue-100 ring-1 ring-blue-300" : "bg-slate-100 hover:bg-slate-200"
                    }`}
                  >
                    <EmojiGlyph emoji={item.emoji} size={22} />
                  </button>
                ))}
              </div>
            </section>
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
