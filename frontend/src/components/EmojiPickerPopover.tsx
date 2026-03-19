import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TELEGRAM_EMOJI_CATEGORIES } from "../data/telegram-emojis";
import { EmojiCategoryList } from "./EmojiCategoryList";

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
        className="ui-popover-surface fixed z-[200] rounded-xl"
        style={{ top: position.top, left: position.left, width: 320 }}
      >
        <EmojiCategoryList
          categories={TELEGRAM_EMOJI_CATEGORIES}
          onSelectEmoji={(emoji) => { onChange(emoji); setOpen(false); }}
          selectedEmoji={value}
          height={26 * 16}
          buttonSize={36}
          leadingContent={
            <section className="mb-3">
              <div className="mb-1 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Options
              </div>
              <div className="grid grid-cols-8 gap-1">
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); }}
                  title={emptyLabel}
                  className={`ui-picker-tile flex h-9 w-9 items-center justify-center rounded-lg text-lg ${
                    !value ? "ui-picker-tile-active" : ""
                  }`}
                >
                  -
                </button>
              </div>
            </section>
          }
        />
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
