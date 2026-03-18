import { useState, useRef, useEffect } from "react";

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

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
            (emoji || "") === (value || "")
              ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
              : "bg-slate-100 hover:bg-slate-200 text-slate-600"
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
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl border transition-colors ${
            value ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-100 border-slate-200 text-slate-500"
          }`}
          title={label}
        >
          {value || "−"}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 p-2 bg-white rounded-xl border border-slate-200 shadow-lg">
            {grid}
          </div>
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
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
            (emoji || "") === (value || "")
              ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
              : "bg-slate-100 hover:bg-slate-200 text-slate-600"
          }`}
        >
          {emoji || "−"}
        </button>
      ))}</div>
    </div>
  );
}
