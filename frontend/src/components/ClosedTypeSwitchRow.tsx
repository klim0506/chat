import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../lib/i18n";
import { TOP_LAYER_Z_INDEX } from "./TopLayerPortal";

type Props = {
  /** When true, chat/channel is closed (approval required). */
  closed: boolean;
  onClosedChange: (closed: boolean) => void;
  /** Shown on hover over the help icon (native tooltip). */
  tooltip: string;
  disabled?: boolean;
};

/**
 * Row: «Тип чата» + open/closed word segments + (?) with title=tooltip.
 */
export function ClosedTypeSwitchRow({ closed, onClosedChange, tooltip, disabled }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const [showHint, setShowHint] = useState(false);
  const [hoverHint, setHoverHint] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement | null>(null);
  const helpIconRef = useRef<SVGSVGElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [hintPos, setHintPos] = useState<{ top: number; left: number; transformOrigin: string }>({
    top: 0,
    left: 0,
    transformOrigin: "top right",
  });
  const [arrowCenterX, setArrowCenterX] = useState(24);
  const hintVisible = showHint || hoverHint;

  useLayoutEffect(() => {
    if (!hintVisible) return;
    const updatePos = () => {
      const btn = helpBtnRef.current;
      const hint = hintRef.current;
      if (!btn || !hint) return;
      const rect = btn.getBoundingClientRect();
      const hintRect = hint.getBoundingClientRect();
      const pad = 8;
      const gap = 8;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let left = rect.right - hintRect.width;
      left = Math.max(pad, Math.min(left, viewportW - hintRect.width - pad));

      let top = rect.bottom + gap;
      let transformOrigin = "top right";
      if (top + hintRect.height + pad > viewportH) {
        top = rect.top - hintRect.height - gap;
        transformOrigin = "bottom right";
      }
      top = Math.max(pad, Math.min(top, viewportH - hintRect.height - pad));

      const iconRect = helpIconRef.current?.getBoundingClientRect();
      const targetCenterX = iconRect ? iconRect.left + iconRect.width / 2 : rect.left + rect.width / 2;
      const rawArrowCenterX = targetCenterX - left;
      const minArrowCenterX = 12;
      const maxArrowCenterX = hintRect.width - 12;
      const nextArrowCenterX = Math.max(minArrowCenterX, Math.min(rawArrowCenterX, maxArrowCenterX));

      setHintPos({ top, left, transformOrigin });
      setArrowCenterX(nextArrowCenterX);
    };

    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [hintVisible]);

  useEffect(() => {
    if (!showHint) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (helpBtnRef.current?.contains(target)) return;
      if (hintRef.current?.contains(target)) return;
      setShowHint(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHint(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showHint]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="closed-type-switch-label" id={headingId}>
        {t("createChat.chatType")}
      </span>
      <div className="flex items-center gap-1.5">
        <div
          className="closed-type-segment-group"
          role="radiogroup"
          aria-labelledby={headingId}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!closed}
            disabled={disabled}
            data-active={!closed ? "true" : "false"}
            className="closed-type-segment"
            onClick={() => onClosedChange(false)}
          >
            {t("createChat.segmentOpen")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={closed}
            disabled={disabled}
            data-active={closed ? "true" : "false"}
            className="closed-type-segment"
            onClick={() => onClosedChange(true)}
          >
            {t("createChat.segmentClosed")}
          </button>
        </div>
        <div className="relative">
          <button
            ref={helpBtnRef}
            type="button"
            className="closed-type-switch-help rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(33,55,84,0.35)]"
            aria-label={tooltip}
            aria-describedby={hintVisible ? hintId : undefined}
            aria-expanded={showHint}
            onClick={() => setShowHint((prev) => !prev)}
            onMouseEnter={() => setHoverHint(true)}
            onMouseLeave={() => setHoverHint(false)}
            onFocus={() => setHoverHint(true)}
            onBlur={() => setHoverHint(false)}
          >
            <svg ref={helpIconRef} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
        </div>
      </div>
      {hintVisible && typeof document !== "undefined" && createPortal(
        <div
          ref={hintRef}
          id={hintId}
          role="tooltip"
          className="fixed w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-slate-700/40 bg-slate-900/95 px-3 py-2.5 text-[13px] leading-5 text-slate-100 shadow-[0_16px_36px_rgba(2,6,23,0.35)] backdrop-blur-sm"
          style={{
            top: hintPos.top,
            left: hintPos.left,
            transformOrigin: hintPos.transformOrigin,
            zIndex: TOP_LAYER_Z_INDEX + 10,
          }}
        >
          <span
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 bg-slate-900/95 ${
              hintPos.transformOrigin.startsWith("top")
                ? "-top-1.5 border-l border-t border-slate-700/40"
                : "-bottom-1.5 border-b border-r border-slate-700/40"
            }`}
            style={{ left: arrowCenterX, transform: "translateX(-50%) rotate(45deg)" }}
          />
          {tooltip}
        </div>,
        document.body,
      )}
    </div>
  );
}
