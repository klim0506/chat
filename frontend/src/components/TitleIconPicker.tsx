import { useState, useRef, useEffect } from "react";
import { AnchoredPortal } from "./TopLayerPortal";

/** Popular emojis for chat/channel title icon (Telegram-style). */
const EMOJI_OPTIONS = ["", "📢", "🎯", "💬", "📱", "🌟", "🔥", "📣", "💡", "🎬", "🏠", "✅", "📎", "🔒"];

interface TitleIconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
  /** Compact picker: single button, opens popover with grid */
  compact?: boolean;
}

/** Simple emoji picker for title icon (displayed to the right of chat/channel name). */
export function TitleIconPicker({ value, onChange, label, compact }: TitleIconPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  const grid = (
    <div className="grid grid-cols-7 gap-1">
      {EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji || "none"}
          type="button"
          onClick={() => { onChange(emoji); setOpen(false); }}
          title={emoji ? emoji : "Без иконки"}
          className={`ui-picker-tile h-9 w-9 rounded-lg flex items-center justify-center text-lg ${
            (emoji || "") === (value || "") ? "ui-picker-tile-active" : ""
          }`}
        >
          {emoji || "−"}
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div ref={ref} className="relative shrink-0">
        {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`ui-picker-tile h-10 w-10 rounded-lg flex items-center justify-center text-xl ${
            value ? "ui-picker-tile-active" : ""
          }`}
          title={label}
        >
          {value || "−"}
        </button>
        {open && (
          <AnchoredPortal anchorRef={ref} portalRef={popoverRef} className="ui-popover-surface rounded-xl p-2">
            {grid}
          </AnchoredPortal>
        )}
      </div>
    );
  }

  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
      <div className="flex flex-wrap gap-1">{EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji || "none"}
          type="button"
          onClick={() => onChange(emoji)}
          title={emoji ? emoji : "Без иконки"}
          className={`ui-picker-tile h-9 w-9 rounded-lg flex items-center justify-center text-lg ${
            (emoji || "") === (value || "") ? "ui-picker-tile-active" : ""
          }`}
        >
          {emoji || "−"}
        </button>
      ))}</div>
    </div>
  );
}
