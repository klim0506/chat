import { useId } from "react";
import { useTranslation } from "../lib/i18n";

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
        <button
          type="button"
          className="closed-type-switch-help rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(33,55,84,0.35)]"
          title={tooltip}
          aria-label={tooltip}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}
