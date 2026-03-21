import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react";

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    handler();
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, paymentsApi, sessionsApi, foldersApi, channelsApi, type User, type SubscriptionStatus, type SubscriptionPlan, type ReferralProgress, type UserSessionInfo, type ChatFolder, type Channel, type Chat } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useChatListStore } from "../store/chatList";
import { usePreferencesStore, MESSAGE_TEXT_SCALE_MIN, MESSAGE_TEXT_SCALE_MAX, type MessageTextScale } from "../store/preferences";
import { getAvatarInitials } from "../lib/avatar-initials";
import { AvatarManagerModal } from "../components/AvatarManagerModal";
import { AnchoredPortal, TopLayerPortal, TOP_LAYER_Z_INDEX } from "../components/TopLayerPortal";
import ConfirmModal from "../components/ConfirmModal";
import CreateChannelModal from "../components/CreateChannelModal";
import PaymentMethodsModal from "../components/PaymentMethodsModal";
import SupportModal from "../components/SupportModal";
import CreateFolderModal from "../components/CreateFolderModal";
import { MediaImage } from "../components/MediaImage";

const FOLDER_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#6B7280", "#EC4899", "#14B8A6"];
const FOLDER_EMOJIS = ["📁", "📂", "💼", "⭐", "🏠", "👥", "💬", "❤️", "🔔", "📢", "🎯", "📱", "🌟", "🔥", "📣", "💡", "🎬", "✅", "📎", "🔒"];

function chatTitle(c: Chat): string {
  if (c.title) return c.title;
  if (c.is_personal && c.other_member) {
    return c.other_member.display_name || (c.other_member as { username?: string }).username || c.other_member.phone || "";
  }
  return "";
}
import { EmojiPickerPopover } from "../components/EmojiPickerPopover";
import QrLoginModal from "../components/QrLoginModal";

type SettingsSection = "account" | "chats" | "privacy" | "folders" | "devices" | "premium";
import { useTranslation, t as tFn, getLocale, type AppLanguage, type TranslationKey } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function getStatusLabel(status: string, lang: AppLanguage): string {
  if (status === "trial") return tFn("status.trial", lang);
  if (status === "active") return tFn("status.active", lang);
  if (status === "past_due") return tFn("status.past_due", lang);
  if (status === "cancelled") return tFn("status.cancelled", lang);
  return tFn("settings.noSubscription", lang);
}

export const SETTINGS_NAV = [
  { id: "account", labelKey: "settings.navAccount", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  { id: "chats", labelKey: "settings.navChatSettings", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  { id: "privacy", labelKey: "settings.navPrivacy", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { id: "folders", labelKey: "settings.navFolders", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { id: "devices", labelKey: "settings.navDevices", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { id: "premium", labelKey: "settings.navPremium", icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" },
] as const;

const SETTINGS_PANEL_CLASS = "rounded-[28px] border border-slate-200/80 bg-white/82 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur overflow-hidden";
const SETTINGS_PANEL_HEADER_CLASS = "flex items-start justify-between gap-3 border-b border-slate-100/80 px-6 py-5";
const SETTINGS_PANEL_BODY_CLASS = "px-6 py-5";
/** Единая обводка для карточек внутри «Настройки чатов» (масштаб, выравнивание/язык/тема, звуки). */
const SETTINGS_CHATS_SUBCARD_CLASS =
  "rounded-[24px] border border-slate-200/80 bg-white/72 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]";
const SETTINGS_NAV_SHELL_CLASS = "flex h-full min-h-0 flex-col p-2";
const SETTINGS_NAV_ACTION_CLASS = "flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-left text-sm transition-colors";
const SETTINGS_DESKTOP_NAV_WIDTH = 272;
const SETTINGS_DESKTOP_NAV_OVERLAY_BREAKPOINT = SETTINGS_DESKTOP_NAV_WIDTH * 2 + 56;

function SettingsNav({ section, onSection, t }: { section: SettingsSection; onSection: (s: SettingsSection) => void; t: ReturnType<typeof useTranslation>["t"] }) {
  const navItems = SETTINGS_NAV;
  const getItemSubtitle = (id: SettingsSection) => {
    switch (id) {
      case "account":
        return t("settings.profile");
      case "chats":
        return t("settings.navChatSettingsShort");
      case "privacy":
        return t("settings.privacy");
      case "folders":
        return t("settings.navFolders");
      case "devices":
        return t("settings.activeSessions");
      case "premium":
        return t("settings.subscription");
      default:
        return "";
    }
  };
  return (
    <nav className="flex w-full max-w-[17rem] flex-col gap-1 overflow-y-auto pr-1">
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSection(item.id)}
          aria-current={section === item.id ? "page" : undefined}
          className={`flex w-full items-center gap-2.5 rounded-[20px] border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
            section === item.id
              ? "border-sky-200/80 bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
              : "border-transparent text-slate-600 hover:bg-white/80 hover:text-slate-900"
          }`}
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            section === item.id ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[0.9375rem] font-medium ${section === item.id ? "text-slate-900" : "text-slate-700"}`}>
              {t(item.labelKey)}
            </span>
            <span className="mt-0.5 block truncate text-[0.8125rem] text-slate-400">
              {getItemSubtitle(item.id)}
            </span>
          </span>
          <span className={`shrink-0 transition-colors ${section === item.id ? "text-sky-500" : "text-slate-300"}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>
      ))}
    </nav>
  );
}

export function ReferralProgressBar({ progress, t, lang }: { progress: ReferralProgress; t: ReturnType<typeof useTranslation>["t"]; lang: AppLanguage }) {
  const { invited_count, next_milestone, milestones } = progress;
  const nextTier = next_milestone ?? 80;
  const nextMonths = milestones[String(nextTier)] ?? 12;
  const progressPct = nextTier > 0 ? Math.min(100, (invited_count / nextTier) * 100) : 100;
  const nextLabel = next_milestone
    ? (lang === "ru" ? `${next_milestone} → ${nextMonths} мес.` : `${next_milestone} → ${nextMonths} mo.`)
    : null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-2xl font-bold text-slate-800">{invited_count}</span>
        <span className="text-sm text-slate-500">{t("sub.invitedCount").toLowerCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300 min-w-[2px]"
            style={{ width: `${Math.max(progressPct, invited_count > 0 ? 2 : 0)}%` }}
          />
        </div>
        {nextLabel && <p className="text-xs text-slate-500 mt-0.5">{nextLabel}</p>}
      </div>
    </div>
  );
}

void ReferralProgressBar;

function ReferralProgressCard({
  progress,
  referralLink,
  copied,
  shake,
  onCopy,
  t,
  lang,
}: {
  progress: ReferralProgress;
  referralLink: string;
  copied: boolean;
  shake: boolean;
  onCopy: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  lang: AppLanguage;
}) {
  const [showLevelsModal, setShowLevelsModal] = useState(false);
  const { invited_count, milestones } = progress;
  const tiers = Object.entries(milestones)
    .map(([target, rewardMonths]) => ({ target: Number(target), rewardMonths }))
    .filter((tier) => Number.isFinite(tier.target) && tier.target > 0)
    .sort((a, b) => a.target - b.target);
  const orderedTiers = tiers.length > 0 ? tiers : [
    { target: 10, rewardMonths: 1 },
    { target: 40, rewardMonths: 6 },
    { target: 80, rewardMonths: 12 },
  ];
  const activeTierIndex = orderedTiers.findIndex((tier) => invited_count < tier.target);
  const currentTierIndex = activeTierIndex === -1 ? orderedTiers.length - 1 : activeTierIndex;
  const currentTier = orderedTiers[currentTierIndex];
  const currentTarget = Math.max(1, currentTier.target);
  const progressValue = Math.min(invited_count, currentTarget);
  const progressPct = Math.max(0, Math.min(100, (progressValue / currentTarget) * 100));
  const remaining = Math.max(0, currentTarget - invited_count);

  const formatRewardLabel = (months: number) => (
    lang === "ru"
      ? `Премиум на ${months} ${months === 1 ? "месяц" : months < 5 ? "месяца" : "месяцев"}`
      : `${months} ${months === 1 ? "month" : "months"} Premium`
  );
  const formatGoalLabel = (target: number) => (
    lang === "ru"
      ? `${target} ${target === 1 ? "друг" : target < 5 ? "друга" : "друзей"}`
      : `${target} ${target === 1 ? "friend" : "friends"}`
  );

  const levelLabel = lang === "ru"
    ? `Уровень ${currentTierIndex + 1} из ${orderedTiers.length}`
    : `Level ${currentTierIndex + 1} of ${orderedTiers.length}`;
  const rewardLabel = formatRewardLabel(currentTier.rewardMonths);
  const shortGoalLabel = lang === "ru"
    ? `${progressValue}/${currentTarget}`
    : `${progressValue}/${currentTarget}`;
  const rewardSummary = lang === "ru"
    ? remaining === 0
      ? `Награда доступна: ${rewardLabel}`
      : `Поделитесь ссылкой и откройте награду текущего уровня`
    : remaining === 0
      ? `Reward unlocked: ${rewardLabel}`
      : `Share your link to unlock this level reward`;
  const progressTitle = lang === "ru" ? `Прогресс ${shortGoalLabel}` : `Progress ${shortGoalLabel}`;
  const levelsCta = lang === "ru" ? "Все уровни" : "All levels";
  const levelsModalTitle = lang === "ru" ? "Уровни наград" : "Reward levels";
  const levelCurrentLabel = lang === "ru" ? "Текущий" : "Current";
  const levelDoneLabel = lang === "ru" ? "Получен" : "Done";
  const levelNextLabel = lang === "ru" ? "Далее" : "Next";
  const rewardCardLabel = lang === "ru" ? "Награда" : "Reward";

  const cardSurfaceStyle: CSSProperties = {
    borderColor: "var(--border-subtle)",
    background:
      "linear-gradient(135deg, var(--accent-soft-bg) 0%, var(--surface-1) 42%, var(--surface-2) 100%)",
    boxShadow: "var(--shadow-1)",
  };

  const innerTileStyle: CSSProperties = {
    borderColor: "var(--border-subtle)",
    background: "var(--surface-2)",
  };

  return (
    <>
      <div className="space-y-4 rounded-[28px] border p-5" style={cardSurfaceStyle}>
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>
              {t("settings.referralHeroTitle")}
            </h3>
            <button
              type="button"
              onClick={() => setShowLevelsModal(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] shadow-sm transition-opacity hover:opacity-90"
              style={{
                background: "var(--accent-soft-bg)",
                borderColor: "var(--accent-soft-border)",
                color: "var(--accent-soft-text)",
              }}
            >
              {levelLabel}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          <p className="text-sm leading-6" style={{ color: "var(--text-2)" }}>
            {rewardSummary}
            {remaining > 0 && (
              <>
                {" - "}
                <button
                  type="button"
                  onClick={onCopy}
                  className={`inline max-w-full truncate align-baseline underline-offset-2 transition-opacity hover:opacity-90 hover:underline ${shake ? "animate-username-shake" : ""}`}
                  style={{ color: "var(--accent-soft-text)" }}
                  title={referralLink}
                >
                  {referralLink}
                </button>
              </>
            )}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border px-4 py-4" style={innerTileStyle}>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-2)" }}>
              {rewardCardLabel}
            </p>
            <p className="mt-2 text-lg font-semibold leading-snug" style={{ color: "var(--text-0)" }}>
              {rewardLabel}
            </p>
          </div>

          <div className="rounded-2xl border px-4 py-4" style={innerTileStyle}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold leading-snug" style={{ color: "var(--text-0)" }}>
                {progressTitle}
              </p>
              <button
                type="button"
                onClick={() => setShowLevelsModal(true)}
                className="text-sm font-medium transition-opacity hover:opacity-90"
                style={{ color: "var(--accent-soft-text)" }}
              >
                {levelsCta}
              </button>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--border-subtle)" }}>
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className={`ui-accent-strong w-full inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors ${shake ? "animate-username-shake" : ""}`}
        >
          {copied ? t("common.copied") : t("settings.referralCopyCta")}
        </button>
      </div>

      {showLevelsModal && (
        <TopLayerPortal>
          <div
            className="fixed inset-0 flex items-center justify-center bg-slate-950/35 px-4"
            style={{ zIndex: TOP_LAYER_Z_INDEX }}
            onClick={() => setShowLevelsModal(false)}
          >
            <div
              className="w-full max-w-lg rounded-[28px] border p-5"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--surface-1)",
                boxShadow: "var(--shadow-2)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-2)" }}>
                    {levelsCta}
                  </p>
                  <h4 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-0)" }}>
                    {levelsModalTitle}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLevelsModal(false)}
                  className="rounded-full p-2 text-[color:var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[color:var(--text-0)]"
                  aria-label={t("common.close")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {orderedTiers.map((tier, index) => {
                  const isCurrent = index === currentTierIndex;
                  const isDone = invited_count >= tier.target;
                  const tierRewardLabel = formatRewardLabel(tier.rewardMonths);
                  const tierGoalLabel = formatGoalLabel(tier.target);
                  const rowStyle: CSSProperties = isCurrent
                    ? {
                        borderColor: "var(--accent-soft-border)",
                        background: "var(--accent-soft-bg)",
                      }
                    : isDone
                      ? {
                          borderColor: "rgba(52, 211, 153, 0.45)",
                          background: "rgba(16, 185, 129, 0.14)",
                        }
                      : {
                          borderColor: "var(--border-subtle)",
                          background: "var(--surface-2)",
                        };
                  const badgeStyle: CSSProperties = isCurrent
                    ? {
                        background: "var(--accent-soft-bg)",
                        color: "var(--accent-soft-text)",
                        border: "1px solid var(--accent-soft-border)",
                      }
                    : isDone
                      ? {
                          background: "rgba(16, 185, 129, 0.18)",
                          color: "var(--text-0)",
                          border: "1px solid rgba(52, 211, 153, 0.35)",
                        }
                      : {
                          background: "var(--surface-0)",
                          color: "var(--text-2)",
                        };
                  return (
                    <div
                      key={tier.target}
                      className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                      style={rowStyle}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>
                          {lang === "ru" ? `Уровень ${index + 1}` : `Level ${index + 1}`}
                        </p>
                        <p className="mt-0.5 text-sm" style={{ color: "var(--text-2)" }}>
                          {tierGoalLabel} • {tierRewardLabel}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" style={badgeStyle}>
                        {isCurrent ? levelCurrentLabel : isDone ? levelDoneLabel : levelNextLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </TopLayerPortal>
      )}
    </>
  );
}

function SubscriptionPlansBlock({
  plans,
  subLoading,
  onSubscribe,
  paymentError,
  initialGiftRecipient,
  subscriptionSummary,
  onOpenPaymentMethods,
  t,
  lang,
}: {
  plans: SubscriptionPlan[];
  subLoading: boolean;
  onSubscribe: (planMonths: 1 | 6 | 12 | 24, recipientUserId?: string) => void;
  paymentError?: string;
  initialGiftRecipient?: { id: string; display_name: string } | null;
  /** Показывается компактно над списком тарифов (правая колонка). */
  subscriptionSummary?: {
    status: string;
    is_valid: boolean;
    current_period_end?: string | null;
  };
  /** Ссылка «Способы оплаты» справа от строки статуса. */
  onOpenPaymentMethods?: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  lang: AppLanguage;
}) {
  const [mode, setMode] = useState<"buy" | "gift">(initialGiftRecipient ? "gift" : "buy");
  const [selectedPlan, setSelectedPlan] = useState<1 | 6 | 12 | 24>(1);
  const [giftQuery, setGiftQuery] = useState(initialGiftRecipient?.display_name ?? "");
  const [giftResults, setGiftResults] = useState<{ id: string; display_name: string; username?: string | null }[]>([]);
  const [giftRecipient, setGiftRecipient] = useState<{ id: string; display_name: string } | null>(initialGiftRecipient ?? null);

  useEffect(() => {
    if (mode !== "gift" || !giftQuery.trim() || giftQuery.length < 2) {
      setGiftResults([]);
      return;
    }
    const timer = setTimeout(() => {
      authApi
        .searchUsers(giftQuery.trim())
        .then((r) => setGiftResults(r.data.results.slice(0, 5)))
        .catch(() => setGiftResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, giftQuery]);

  const defaultPlans: SubscriptionPlan[] = plans.length > 0 ? plans : [
    { months: 1, total_rub: 299, per_month_rub: 299, original_rub: null, discount_pct: 0, savings_rub: null },
    { months: 6, total_rub: 1374, per_month_rub: 229, original_rub: 1794, discount_pct: 23, savings_rub: 420 },
    { months: 12, total_rub: 1908, per_month_rub: 159, original_rub: 3588, discount_pct: 47, savings_rub: 1680 },
    { months: 24, total_rub: 2856, per_month_rub: 119, original_rub: 7176, discount_pct: 60, savings_rub: 4320 },
  ];

  const SUB_BENEFIT_KEYS: TranslationKey[] = [
    "premiumModal.benefitFiles",
    "premiumModal.benefitFileUploads",
    "premiumModal.benefitFolders",
    "premiumModal.benefitPins",
    "premiumModal.benefitVideoCircles",
    "premiumModal.benefitReactions",
    "premiumModal.benefitScheduled",
    "premiumModal.benefitChannels",
    "premiumModal.benefitAvatars",
    "premiumModal.benefitPolls",
    "premiumModal.benefitStickers",
    "premiumModal.benefitBio",
  ];

  const benefitItem = (key: TranslationKey) => (
    <li key={key} className="flex items-start gap-2">
      <span className="shrink-0 w-4 h-4 mt-0.5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span>{t(key)}</span>
    </li>
  );

  const giftModeRow = (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button
        type="button"
        onClick={() => { setMode("gift"); setGiftRecipient(null); setGiftQuery(""); }}
        className="text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        {t("sub.gift")}
      </button>
      {mode === "gift" && (
        <button
          type="button"
          onClick={() => { setMode("buy"); setGiftRecipient(null); setGiftQuery(""); }}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          {t("sub.buy")}
        </button>
      )}
    </div>
  );

  const giftRecipientBlock =
    mode === "gift" ? (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-600">{t("sub.giftRecipient")}</label>
        <input
          type="text"
          value={giftQuery}
          onChange={(e) => setGiftQuery(e.target.value)}
          placeholder={t("sub.searchUser")}
          className="w-full px-3 py-2.5 text-sm rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
          style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
        />
        {giftResults.length > 0 && !giftRecipient && (
          <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-32 overflow-y-auto">
            {giftResults.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => { setGiftRecipient({ id: u.id, display_name: u.display_name }); setGiftQuery(u.display_name); setGiftResults([]); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                >
                  {u.display_name}{u.username ? ` @${u.username}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
        {giftRecipient && (
          <p className="text-sm text-slate-600">
            {t("sub.giftingTo")}: <strong>{giftRecipient.display_name}</strong>
            <button type="button" onClick={() => setGiftRecipient(null)} className="ml-2 text-red-600 text-xs">
              {t("common.cancel")}
            </button>
          </p>
        )}
      </div>
    ) : null;

  const plansBlock = (
    <>
      <div className="space-y-2">
        {defaultPlans.map((p) => {
          const discount = p.discount_pct ?? 0;
          const hasOriginal = p.original_rub != null && p.original_rub > p.total_rub;
          return (
            <button
              key={p.months}
              type="button"
              onClick={() => setSelectedPlan(p.months as 1 | 6 | 12 | 24)}
              className={`relative w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-colors ${
                selectedPlan === p.months ? "bg-blue-50/80 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.30)]" : "hover:bg-slate-50/70"
              }`}
              style={{ borderColor: selectedPlan === p.months ? "rgba(59,130,246,0.40)" : "var(--border-subtle)" }}
            >
              {discount > 0 && (
                <span className="absolute top-0 right-2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-green-500 text-white text-xs font-bold shadow-sm">
                  −{discount}%
                </span>
              )}
              <div className="text-left flex-1 min-w-0">
                <span className="font-medium text-slate-800 block">
                  {p.months === 1 ? (lang === "ru" ? "Ежемесячно" : "Monthly") :
                   p.months === 6 ? (lang === "ru" ? "На полгода" : "6 months") :
                   p.months === 12 ? (lang === "ru" ? "Ежегодно" : "Annually") :
                   (lang === "ru" ? "На 2 года" : "2 years")}
                </span>
                <p className="text-sm text-slate-600 mt-1">
                  {hasOriginal && (
                    <span className="line-through text-slate-400 mr-2">{p.original_rub} ₽</span>
                  )}
                  <span className="font-medium text-slate-800">{p.total_rub} ₽</span>
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="font-semibold text-slate-800">
                  {p.per_month_rub} {t("sub.pricePerMonth")}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => {
          if (mode === "gift" && !giftRecipient) return;
          onSubscribe(selectedPlan, mode === "gift" ? giftRecipient?.id : undefined);
        }}
        disabled={subLoading || (mode === "gift" && !giftRecipient)}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
      >
        {subLoading ? t("settings.goToPayment") : (mode === "gift" ? t("sub.giftSubscribe") : t("sub.subscribe"))}
      </button>
      {paymentError && (
        <p className="text-sm text-red-600 mt-2" role="alert">
          {paymentError}
        </p>
      )}
    </>
  );

  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">
      {/* Benefits: single column */}
      <div className="space-y-4 mb-6 lg:mb-0">
        <p className="text-2xl font-semibold text-slate-800 mb-2">{t("sub.benefitsTitle")}</p>
        <ul className="space-y-1.5 text-sm text-slate-700">
          {SUB_BENEFIT_KEYS.map((key) => benefitItem(key))}
        </ul>
        {giftModeRow}
        {giftRecipientBlock}
      </div>

      {/* Plans and CTA: right column on desktop */}
      <div className="space-y-4 lg:sticky lg:top-6">
        {subscriptionSummary ? (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium">
                <span className="text-slate-600">{t("settings.status")}</span>
                <span
                  className={subscriptionSummary.is_valid ? "text-green-600" : "text-red-600"}
                >
                  {getStatusLabel(subscriptionSummary.status, lang)}
                </span>
              </div>
              {subscriptionSummary.current_period_end && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-slate-600">
                  <span>{t("settings.validUntil")}</span>
                  <span className="font-medium text-slate-800">
                    {new Date(subscriptionSummary.current_period_end).toLocaleDateString(getLocale(lang))}
                  </span>
                </div>
              )}
            </div>
            {onOpenPaymentMethods && (
              <button
                type="button"
                onClick={onOpenPaymentMethods}
                className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t("settings.paymentMethods")}
              </button>
            )}
          </div>
        ) : (
          onOpenPaymentMethods && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onOpenPaymentMethods}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t("settings.paymentMethods")}
              </button>
            </div>
          )
        )}
        {plansBlock}
      </div>
    </div>
  );
}

function SessionsSection() {
  const { t, lang } = useTranslation();
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);

  useEffect(() => {
    sessionsApi
      .list()
      .then((r) => setSessions(r.data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const handleTerminate = async (id: string) => {
    setTerminating(id);
    try {
      await sessionsApi.terminate(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
    setTerminating(null);
  };

  const handleLogoutAll = async () => {
    setLogoutAllLoading(true);
    try {
      await sessionsApi.logoutAll();
      setSessions((prev) => prev.filter((s) => s.is_current));
    } catch {
      /* ignore */
    }
    setLogoutAllLoading(false);
  };

  if (loading) return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  if (sessions.length === 0)
    return <p className="text-sm text-slate-500">{t("settings.noSessions")}</p>;

  const otherSessions = sessions.filter((s) => !s.is_current);
  const locale = getLocale(lang);

  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`flex items-center justify-between py-2.5 px-3 rounded-2xl border ${s.is_current ? "bg-blue-50/70" : ""}`}
          style={{ background: s.is_current ? "rgba(59,130,246,0.08)" : "var(--surface-2)", borderColor: "var(--border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--text-0)" }}>
                {s.device_label || t("settings.unknownDevice")}
              </p>
              {s.is_current && (
                <span className="shrink-0 text-[0.625rem] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                  {t("settings.currentSession")}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
              {s.ip_address && <span>{s.ip_address} · </span>}
              {t("settings.loginAt")}: {new Date(s.created_at).toLocaleDateString(locale)}{" "}
              {new Date(s.created_at).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {!s.is_current && (
                <span>
                  {" "}
                  · {t("settings.activeAt")}:{" "}
                  {new Date(s.last_active).toLocaleDateString(locale)}{" "}
                  {new Date(s.last_active).toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </p>
          </div>
          {!s.is_current && (
            <button
              type="button"
              onClick={() => handleTerminate(s.id)}
              disabled={terminating === s.id}
              className="shrink-0 ml-3 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {terminating === s.id ? "..." : t("settings.terminateSession")}
            </button>
          )}
        </div>
      ))}
      {otherSessions.length > 0 && (
        <button
          type="button"
          onClick={handleLogoutAll}
          disabled={logoutAllLoading}
          className="w-full mt-1 py-2.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
        >
          {logoutAllLoading
            ? t("settings.terminatingAll")
            : `${t("settings.terminateAllOtherSessions")} (${otherSessions.length})`}
        </button>
      )}
    </div>
  );
}

function SoundsSection() {
  const { t } = useTranslation();
  const soundEnabled = usePreferencesStore((s) => s.soundEnabled);
  const soundSend = usePreferencesStore((s) => s.soundSend);
  const soundReceive = usePreferencesStore((s) => s.soundReceive);
  const soundMention = usePreferencesStore((s) => s.soundMention);
  const setSoundEnabled = usePreferencesStore((s) => s.setSoundEnabled);
  const setSoundSend = usePreferencesStore((s) => s.setSoundSend);
  const setSoundReceive = usePreferencesStore((s) => s.setSoundReceive);
  const setSoundMention = usePreferencesStore((s) => s.setSoundMention);

  const toggleClass = (enabled: boolean) => `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
    enabled ? "bg-blue-600" : "bg-slate-300"
  }`;

  const soundRow = (
    title: string,
    hint: string,
    enabled: boolean,
    onClick: () => void,
    disabled?: boolean
  ) => (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${toggleClass(enabled)} shrink-0 disabled:cursor-not-allowed disabled:opacity-70`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 m-0.5 ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className={!soundEnabled ? "opacity-50" : ""}>
      {soundRow(t("settings.enableSounds"), t("settings.sounds"), soundEnabled, () => setSoundEnabled(!soundEnabled))}
      {soundRow(t("settings.soundSend"), t("settings.enableSounds"), soundSend, () => setSoundSend(!soundSend), !soundEnabled)}
      {soundRow(t("settings.soundReceive"), t("settings.notifications"), soundReceive, () => setSoundReceive(!soundReceive), !soundEnabled)}
      {soundRow(t("settings.soundMention"), "@ mention", soundMention, () => setSoundMention(!soundMention), !soundEnabled)}
    </div>
  );
}

function MessageScaleSlider() {
  const { t } = useTranslation();
  const scale = usePreferencesStore((s) => s.messageTextScale);
  const setScale = usePreferencesStore((s) => s.setMessageTextScale);
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="shrink-0 text-sm font-semibold text-slate-700">{t("settings.messageTextScale")}</span>
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-md sm:justify-end">
        <input
          type="range"
          min={MESSAGE_TEXT_SCALE_MIN}
          max={MESSAGE_TEXT_SCALE_MAX}
          step={0.01}
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value) as MessageTextScale)}
          className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-600 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow"
          aria-label={t("settings.messageTextScale")}
        />
        <span className="w-14 shrink-0 rounded-full bg-slate-100 px-2 py-1 text-center text-sm font-semibold text-slate-700 tabular-nums">
          {Math.round(scale * 100)}%
        </span>
      </div>
    </div>
  );
}

function FoldersSection({ t, onFoldersUpdated, hasSubscription = false }: { t: ReturnType<typeof useTranslation>["t"]; onFoldersUpdated?: () => void; hasSubscription?: boolean }) {
  const folderLayout = usePreferencesStore((s) => s.folderLayout);
  const setFolderLayout = usePreferencesStore((s) => s.setFolderLayout);
  const showFolderPersonal = usePreferencesStore((s) => s.showFolderPersonal);
  const setShowFolderPersonal = usePreferencesStore((s) => s.setShowFolderPersonal);
  const showFolderUnread = usePreferencesStore((s) => s.showFolderUnread);
  const setShowFolderUnread = usePreferencesStore((s) => s.setShowFolderUnread);
  const showFolderArchive = usePreferencesStore((s) => s.showFolderArchive);
  const setShowFolderArchive = usePreferencesStore((s) => s.setShowFolderArchive);
  const folderColorPersonal = usePreferencesStore((s) => s.folderColorPersonal);
  const setFolderColorPersonal = usePreferencesStore((s) => s.setFolderColorPersonal);
  const folderColorUnread = usePreferencesStore((s) => s.folderColorUnread);
  const setFolderColorUnread = usePreferencesStore((s) => s.setFolderColorUnread);
  const folderColorArchive = usePreferencesStore((s) => s.folderColorArchive);
  const setFolderColorArchive = usePreferencesStore((s) => s.setFolderColorArchive);
  const foldersEnabledRaw = usePreferencesStore((s) => s.foldersEnabled);
  const setFoldersEnabled = usePreferencesStore((s) => s.setFoldersEnabled);
  /** Без Premium папки всегда считаются выключенными (даже если в localStorage было true). */
  const foldersEnabledEffective = hasSubscription && foldersEnabledRaw;
  const [foldersPremiumToast, setFoldersPremiumToast] = useState(false);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("📁");
  const [editColor, setEditColor] = useState("#3B82F6");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const colorPickerPopoverRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerPopoverRef = useRef<HTMLDivElement | null>(null);
  const chats = useChatListStore((s) => s.chats);
  const storeUpdateChat = useChatListStore((s) => s.updateChat);
  useEffect(() => {
    if (!colorPickerOpen && !emojiPickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inColor = colorPickerRef.current?.contains(target) || colorPickerPopoverRef.current?.contains(target);
      const inEmoji = emojiPickerRef.current?.contains(target) || emojiPickerPopoverRef.current?.contains(target);
      if (!inColor && !inEmoji) {
        setColorPickerOpen(null);
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [colorPickerOpen, emojiPickerOpen]);

  const loadFolders = useCallback(() => {
    foldersApi.list()
      .then((r) => setFolders(Array.isArray(r.data) ? r.data : []))
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (!hasSubscription && foldersEnabledRaw) {
      setFoldersEnabled(false);
    }
  }, [hasSubscription, foldersEnabledRaw, setFoldersEnabled]);

  const handleUpdateFolderColor = async (folder: ChatFolder, color: string) => {
    try {
      const { data } = await foldersApi.update(folder.id, { color });
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? data : f)));
      setColorPickerOpen(null);
      setEditColor(color);
      onFoldersUpdated?.();
    } catch { /* ignore */ }
  };

  const handleSaveFolder = async (folder: ChatFolder) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const { data } = await foldersApi.update(folder.id, { name: trimmed, emoji: editEmoji || undefined, color: editColor || undefined });
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? data : f)));
      setExpandedFolderId(null);
      onFoldersUpdated?.();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleAddChatToFolder = async (folderId: string, chatId: string) => {
    setAdding(chatId);
    try {
      await foldersApi.addChat(folderId, chatId);
      const chat = chats.find((c) => c.id === chatId);
      if (chat) storeUpdateChat(chatId, { folder_ids: [...(chat.folder_ids || []), folderId] });
    } catch { /* ignore */ }
    setAdding(null);
  };

  const handleRemoveChatFromFolder = async (folderId: string, chatId: string) => {
    setRemoving(chatId);
    try {
      await foldersApi.removeChat(folderId, chatId);
      const chat = chats.find((c) => c.id === chatId);
      if (chat) storeUpdateChat(chatId, { folder_ids: (chat.folder_ids || []).filter((id) => id !== folderId) });
    } catch { /* ignore */ }
    setRemoving(null);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await foldersApi.delete(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      onFoldersUpdated?.();
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const handleToggleFolders = () => {
    if (!hasSubscription) {
      usePremiumModalStore.getState().openModal();
      setFoldersPremiumToast(true);
      window.setTimeout(() => setFoldersPremiumToast(false), 4000);
      return;
    }
    setFoldersEnabled(!foldersEnabledRaw);
  };

  const renderFolderVisibilityToggle = (enabled: boolean, onToggle: () => void) => (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        enabled ? "bg-blue-600" : "bg-slate-200"
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Переключатель вкл/выкл папки: бесплатные пользователи не могут включить */}
      <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-200">
        <p className="text-sm font-medium text-slate-800">{t("folders.enabled")}</p>
        <button
          type="button"
          onClick={handleToggleFolders}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            foldersEnabledEffective ? "bg-blue-600 cursor-pointer" : "bg-slate-200 cursor-pointer"
          }`}
          aria-pressed={foldersEnabledEffective}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              foldersEnabledEffective ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <div
        className={`space-y-6 ${!foldersEnabledEffective ? "opacity-50 pointer-events-none select-none" : ""}`}
      >
      {loading ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
      <>
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">{t("folders.tabsView")}</h3>
        <div className="flex flex-wrap gap-3">
          <label
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => setFolderLayout("left")}
          >
            <input
              type="radio"
              name="folderLayout"
              value="left"
              checked={folderLayout === "left"}
              onChange={() => setFolderLayout("left")}
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700">{t("folders.tabsLeft")}</span>
          </label>
          <label
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => setFolderLayout("top")}
          >
            <input
              type="radio"
              name="folderLayout"
              value="top"
              checked={folderLayout === "top"}
              onChange={() => setFolderLayout("top")}
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700">{t("folders.tabsTop")}</span>
          </label>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">{t("folders.standardFolders")}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="relative shrink-0" ref={colorPickerOpen === "personal" ? colorPickerRef : undefined}>
                <button type="button" onClick={() => setColorPickerOpen((p) => (p === "personal" ? null : "personal"))} className="w-3 h-3 rounded-full border border-slate-300 hover:ring-2 hover:ring-slate-300 transition-shadow shrink-0" style={{ backgroundColor: folderColorPersonal }} title={t("folders.color")} />
                {colorPickerOpen === "personal" && (
                  <AnchoredPortal anchorRef={colorPickerRef} portalRef={colorPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg">
                    <div className="grid grid-cols-4 gap-1.5">{FOLDER_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => { setFolderColorPersonal(c); setColorPickerOpen(null); }} className={`w-6 h-6 rounded border-2 transition-all ${folderColorPersonal === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`} style={{ backgroundColor: c }} />
                    ))}</div>
                  </AnchoredPortal>
                )}
              </div>
              <span className="text-sm font-medium text-slate-800">{t("folders.standardPersonal")}</span>
            </div>
            {renderFolderVisibilityToggle(showFolderPersonal, () => setShowFolderPersonal(!showFolderPersonal))}
          </div>
          <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="relative shrink-0" ref={colorPickerOpen === "unread" ? colorPickerRef : undefined}>
                <button type="button" onClick={() => setColorPickerOpen((p) => (p === "unread" ? null : "unread"))} className="w-3 h-3 rounded-full border border-slate-300 hover:ring-2 hover:ring-slate-300 transition-shadow shrink-0" style={{ backgroundColor: folderColorUnread }} title={t("folders.color")} />
                {colorPickerOpen === "unread" && (
                  <AnchoredPortal anchorRef={colorPickerRef} portalRef={colorPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg">
                    <div className="grid grid-cols-4 gap-1.5">{FOLDER_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => { setFolderColorUnread(c); setColorPickerOpen(null); }} className={`w-6 h-6 rounded border-2 transition-all ${folderColorUnread === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`} style={{ backgroundColor: c }} />
                    ))}</div>
                  </AnchoredPortal>
                )}
              </div>
              <span className="text-sm font-medium text-slate-800">{t("folders.standardUnread")}</span>
            </div>
            {renderFolderVisibilityToggle(showFolderUnread, () => setShowFolderUnread(!showFolderUnread))}
          </div>
          <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="relative shrink-0" ref={colorPickerOpen === "archive" ? colorPickerRef : undefined}>
                <button type="button" onClick={() => setColorPickerOpen((p) => (p === "archive" ? null : "archive"))} className="w-3 h-3 rounded-full border border-slate-300 hover:ring-2 hover:ring-slate-300 transition-shadow shrink-0" style={{ backgroundColor: folderColorArchive }} title={t("folders.color")} />
                {colorPickerOpen === "archive" && (
                  <AnchoredPortal anchorRef={colorPickerRef} portalRef={colorPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg">
                    <div className="grid grid-cols-4 gap-1.5">{FOLDER_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => { setFolderColorArchive(c); setColorPickerOpen(null); }} className={`w-6 h-6 rounded border-2 transition-all ${folderColorArchive === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`} style={{ backgroundColor: c }} />
                    ))}</div>
                  </AnchoredPortal>
                )}
              </div>
              <span className="text-sm font-medium text-slate-800">{t("folders.standardArchive")}</span>
            </div>
            {renderFolderVisibilityToggle(showFolderArchive, () => setShowFolderArchive(!showFolderArchive))}
          </div>
        </div>
      </div>
      <div>
      <button
        type="button"
        onClick={() => setShowCreateModal(true)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        {t("folders.create")}
      </button>
      {folders.length > 0 && (
        <ul className="space-y-3">
          {folders.map((f) => (
            <li key={f.id} className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
              <div>
              <div className="flex items-center justify-between py-2.5 px-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="relative shrink-0" ref={colorPickerOpen === f.id ? colorPickerRef : undefined}>
                    <button
                      type="button"
                      onClick={() => setColorPickerOpen((p) => (p === f.id ? null : f.id))}
                      className="w-3 h-3 rounded-full border border-slate-300 hover:ring-2 hover:ring-slate-300 transition-shadow shrink-0"
                      style={{ backgroundColor: f.color || "#3B82F6" }}
                      title={t("folders.color")}
                    />
                    {colorPickerOpen === f.id && (
                      <AnchoredPortal anchorRef={colorPickerRef} portalRef={colorPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg">
                        <div className="grid grid-cols-4 gap-1.5">
                          {FOLDER_COLORS.map((c) => (
                            <button key={c} type="button" onClick={() => handleUpdateFolderColor(f, c)} className={`w-6 h-6 rounded border-2 transition-all ${(f.color || "#3B82F6") === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`} style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </AnchoredPortal>
                    )}
                  </div>
                  <span className="text-lg shrink-0">{f.emoji || "📁"}</span>
                  <span className="text-sm font-medium text-slate-800 truncate">{f.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => { setExpandedFolderId(expandedFolderId === f.id ? null : f.id); if (expandedFolderId !== f.id) { setEditName(f.name); setEditEmoji(f.emoji || ""); setEditColor(f.color || "#3B82F6"); } }} className="p-1 text-slate-400 hover:text-blue-600" title={t("folders.settings")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                  <button type="button" onClick={() => handleDelete(f.id)} disabled={deleting === f.id} className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50">
                    {deleting === f.id ? "…" : t("common.delete")}
                  </button>
                </div>
              </div>
              {expandedFolderId === f.id && (
                <div className="border-t border-slate-200 px-3 py-3 space-y-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("folders.namePlaceholder")} className="px-2 py-1 text-sm border border-slate-200 rounded w-32" />
                    <div className="relative" ref={emojiPickerOpen ? emojiPickerRef : undefined}>
                      <button type="button" onClick={() => setEmojiPickerOpen((v) => !v)} className="text-xl px-1 py-0.5 border border-slate-200 rounded">{editEmoji || "📁"}</button>
                      {emojiPickerOpen && (
                        <AnchoredPortal anchorRef={emojiPickerRef} portalRef={emojiPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                          {FOLDER_EMOJIS.map((e) => (
                            <button key={e} type="button" onClick={() => { setEditEmoji(e); setEmojiPickerOpen(false); }} className="text-lg p-1 hover:bg-slate-100 rounded">{e}</button>
                          ))}
                        </AnchoredPortal>
                      )}
                    </div>
                    <div className="relative" ref={colorPickerOpen === f.id ? colorPickerRef : undefined}>
                      <button type="button" onClick={() => setColorPickerOpen((p) => (p === f.id ? null : f.id))} className="w-6 h-6 rounded border border-slate-300" style={{ backgroundColor: editColor }} title={t("folders.color")} />
                      {colorPickerOpen === f.id && (
                        <AnchoredPortal anchorRef={colorPickerRef} portalRef={colorPickerPopoverRef} className="p-2 bg-white rounded-lg border border-slate-200 shadow-lg">
                          <div className="grid grid-cols-4 gap-1.5">{FOLDER_COLORS.map((c) => (
                            <button key={c} type="button" onClick={() => { setEditColor(c); handleUpdateFolderColor(f, c); }} className={`w-6 h-6 rounded border-2 transition-all ${editColor === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`} style={{ backgroundColor: c }} />
                          ))}</div>
                        </AnchoredPortal>
                      )}
                    </div>
                    <button type="button" onClick={() => handleSaveFolder(f)} disabled={saving || !editName.trim()} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{saving ? "…" : t("common.save")}</button>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">{t("folders.chatsInFolder")}</p>
                    <div className="space-y-1 mb-2">
                      {chats.filter((c) => (c.folder_ids || []).includes(f.id)).map((chat) => (
                        <div key={chat.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-white border border-slate-100">
                          <span className="text-sm truncate">{chatTitle(chat)}</span>
                          <button type="button" onClick={() => handleRemoveChatFromFolder(f.id, chat.id)} disabled={removing === chat.id} className="text-red-500 text-xs hover:text-red-700">{removing === chat.id ? "…" : t("common.remove")}</button>
                        </div>
                      ))}
                    </div>
                    <select
                      value=""
                      onChange={(e) => { const id = e.target.value; if (id) { handleAddChatToFolder(f.id, id); e.target.value = ""; } }}
                      disabled={!!adding}
                      className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 disabled:opacity-50"
                    >
                      <option value="">{t("folders.addChatToFolder")}</option>
                      {chats.filter((c) => !(c.folder_ids || []).includes(f.id)).map((c) => (
                        <option key={c.id} value={c.id}>{chatTitle(c)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateFolderModal
        isOpen={showCreateModal}
        chats={chats}
        onClose={() => setShowCreateModal(false)}
        onCreated={(folder, selectedChatIds) => {
          setFolders((prev) => [...prev, folder].sort((a, b) => a.position - b.position));
          selectedChatIds.forEach((chatId) => {
            const chat = chats.find((item) => item.id === chatId);
            if (!chat) return;
            storeUpdateChat(chatId, { folder_ids: [...new Set([...(chat.folder_ids || []), folder.id])] });
          });
          setShowCreateModal(false);
          onFoldersUpdated?.();
        }}
      />
      </div>
      </>
      )}
      </div>
      {foldersPremiumToast && (
        <TopLayerPortal>
          <div
            role="status"
            className="fixed bottom-6 left-1/2 max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl bg-slate-800 px-4 py-3 text-center text-sm text-white shadow-lg"
            style={{ zIndex: TOP_LAYER_Z_INDEX }}
          >
            {t("folders.premiumRequiredToast")}
          </div>
        </TopLayerPortal>
      )}
    </div>
  );
}

export default function SettingsPage({
  embed = false,
  onFoldersUpdated,
  onMobileInSubSection,
}: {
  embed?: boolean;
  onFoldersUpdated?: () => void;
  /** Called when on mobile and user is viewing a subsection (e.g. Account); used by parent to hide top "back to chats" header */
  onMobileInSubSection?: (value: boolean) => void;
}) {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section") as SettingsSection | null;
  const setSection = (s: SettingsSection) => setSearchParams({ section: s });
  const giftRecipientIdParam = searchParams.get("gift_user_id");
  const giftRecipientNameParam = searchParams.get("gift_name");
  const initialGiftRecipient = giftRecipientIdParam
    ? { id: giftRecipientIdParam, display_name: giftRecipientNameParam || `@${giftRecipientIdParam}` }
    : null;
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const [desktopShowContent, setDesktopShowContent] = useState(false);
  const [desktopUseOverlay, setDesktopUseOverlay] = useState(false);
  const clearTokens = useAuthStore((s) => s.clearTokens);
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const messageAlignment = usePreferencesStore((s) => s.messageAlignment);
  const setMessageAlignment = usePreferencesStore((s) => s.setMessageAlignment);

  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorToast, setErrorToast] = useState("");
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(""), 6000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const section: SettingsSection = sectionParam && SETTINGS_NAV.some((n) => n.id === sectionParam) ? sectionParam : "account";
  const mainContentRef = useRef<HTMLElement | null>(null);
  const desktopLayoutRef = useRef<HTMLDivElement | null>(null);

  /* edit state */
  const [editing, setEditing] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [birthday, setBirthday] = useState("");
  const [birthdayHideYear, setBirthdayHideYear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [usernameShake, setUsernameShake] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showQrLoginModal, setShowQrLoginModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [myChannels, setMyChannels] = useState<Channel[]>([]);
  const [showPersonalChannelMenu, setShowPersonalChannelMenu] = useState(false);
  const personalChannelButtonRef = useRef<HTMLDivElement | null>(null);
  const personalChannelPopoverRef = useRef<HTMLDivElement | null>(null);

  /* subscription */
  const [subLoading, setSubLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [referralShake, setReferralShake] = useState(false);
  const [showPaymentMethodsModal, setShowPaymentMethodsModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const subscriptionPlansRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPersonalChannelMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideButton = personalChannelButtonRef.current?.contains(target);
      const insideMenu = personalChannelPopoverRef.current?.contains(target);
      if (!insideButton && !insideMenu) setShowPersonalChannelMenu(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showPersonalChannelMenu]);

  const loadProfile = useCallback(() => {
    setError("");
    setLoading(true);
    authApi.me()
      .then((userRes) => {
        setUser(userRes.data);
        setDisplayName(userRes.data.display_name || "");
        setUsername(userRes.data.username ?? "");
        setBio(userRes.data.bio || "");
        setBirthday(userRes.data.birthday || "");
        setBirthdayHideYear(Boolean(userRes.data.birthday_hide_year));
        return paymentsApi.getSubscription().then((subRes) => {
          setSub(subRes.data);
        }).catch(() => setSub(null));
      })
      .catch(() => {
        const msg = t("settings.loadProfileError");
        setError(msg);
        setErrorToast(msg);
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (section === "account" && user && sub?.is_valid) {
      const uid = user.id;
      channelsApi.list()
        .then((res) => {
          const mine = (res.data.results || []).filter((c) => c.owner.id === uid);
          setMyChannels(mine);
        })
        .catch(() => setMyChannels([]));
    } else if (section === "account" && user && sub && !sub.is_valid) {
      setMyChannels([]);
    }
  }, [section, user?.id, sub?.is_valid]);

  useEffect(() => {
    if (embed) onMobileInSubSection?.(isMobile && mobileShowContent);
  }, [embed, isMobile, mobileShowContent, onMobileInSubSection]);

  useEffect(() => {
    if (!embed || isMobile) {
      setDesktopUseOverlay(false);
      setDesktopShowContent(false);
      return;
    }
    const node = desktopLayoutRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentRect.width ?? 0;
      setDesktopUseOverlay(width > 0 && width < SETTINGS_DESKTOP_NAV_OVERLAY_BREAKPOINT);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [embed, isMobile]);

  useEffect(() => {
    if (!desktopUseOverlay) {
      setDesktopShowContent(false);
    }
  }, [desktopUseOverlay]);

  /* Плавная прокрутка к началу при смене раздела — убирает дёрганье */
  useEffect(() => {
    if (!mainContentRef.current) return;
    mainContentRef.current.scrollTop = 0;
  }, [section]);

  const handleChannelCreated = useCallback(() => {
    // Refresh "my channels" list so newly created channel is available immediately.
    if (!user?.id) return;
    channelsApi.list()
      .then((res) => {
        const mine = (res.data.results || []).filter((c) => c.owner.id === user.id);
        setMyChannels(mine);
      })
      .catch(() => {});
  }, [user?.id]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await authApi.updateMe({ display_name: displayName });
      setUser(res.data);
      setEditing(false);
      setSaveMsg(t("common.saved"));
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg(t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUsername = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const val = username.trim() || undefined;
      const res = await authApi.updateMe({ username: val ?? null });
      setUser(res.data);
      setEditingUsername(false);
      setUsername(res.data.username ?? "");
      setSaveMsg(t("common.saved"));
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { username?: string[]; detail?: string } } })?.response?.data;
      const err = Array.isArray(msg?.username) ? msg!.username[0] : (msg?.detail ?? t("common.saveError"));
      setSaveMsg(typeof err === "string" ? err : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBio = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await authApi.updateMe({ bio: bio.trim() || undefined });
      setUser(res.data);
      setEditingBio(false);
      setSaveMsg(t("common.saved"));
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg(t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSetPersonalChannel = useCallback(async (channelId: string | null) => {
    setSaving(true);
    try {
      const res = await authApi.updateMe({ personal_channel_id: channelId });
      setUser(res.data);
      setShowPersonalChannelMenu(false);
      setSaveMsg(t("common.saved"));
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg(t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [t]);

  const handleSaveBirthday = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const val = birthday.trim() || undefined;
      const res = await authApi.updateMe({
        birthday: val ?? null,
        birthday_hide_year: birthdayHideYear,
      });
      setUser(res.data);
      setEditingBirthday(false);
      setBirthday(res.data.birthday || "");
      setBirthdayHideYear(Boolean(res.data.birthday_hide_year));
      setSaveMsg(t("common.saved"));
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg(t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarModalUpdated = () => {
    authApi.me().then((res) => setUser(res.data));
  };

  const [paymentError, setPaymentError] = useState("");
  const startSubscriptionCheckout = useCallback(
    async (params: {
      plan_months?: 1 | 6 | 12 | 24;
      recipient_user_id?: string;
      offer_code?: string;
    }) => {
      setPaymentError("");
      setSubLoading(true);
      try {
        const returnUrl = window.location.origin + window.location.pathname + "?paid=1";
        const { data } = await paymentsApi.subscribe({
          return_url: returnUrl,
          ...params,
        });
        if (data.confirmation_url) {
          window.open(data.confirmation_url, "_blank", "noopener,noreferrer");
          return;
        }
        const subRes = await paymentsApi.getSubscription();
        setSub(subRes.data);
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        const msg = detail || t("settings.paymentError");
        setPaymentError(msg);
        setErrorToast(msg);
      } finally {
        setSubLoading(false);
      }
    },
    [t],
  );
  const handleSubscribe = async (planMonths: 1 | 6 | 12 | 24, recipientUserId?: string) =>
    startSubscriptionCheckout({
      plan_months: planMonths,
      ...(recipientUserId ? { recipient_user_id: recipientUserId } : {}),
    });
  /** Из модалки Premium: ?checkout=intro — сразу запускаем оплату пробной недели (привязка карты). */
  useEffect(() => {
    if (searchParams.get("checkout") !== "intro") return;
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
    void startSubscriptionCheckout({ offer_code: "intro_week" });
  }, [searchParams, setSearchParams, startSubscriptionCheckout]);

  const handleCopyReferral = () => {
    const code = user?.referral_code;
    if (!code) return;
    const link = `${window.location.origin}/auth?ref=${code}`;
    copyToClipboard(link);
    setReferralShake(true);
    setTimeout(() => setReferralShake(false), 400);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    clearTokens();
    navigate("/auth");
  };

  const plans = sub?.plans ?? [];
  const referralProgress = sub?.referral_progress ?? { invited_count: 0, claimed_tiers: [], next_milestone: 10, milestones: { "10": 1, "40": 6, "80": 12 } };

  const handleSectionSelect = (s: SettingsSection) => {
    setSection(s);
    if (isMobile) setMobileShowContent(true);
    if (!isMobile && desktopUseOverlay) setDesktopShowContent(true);
  };

  const currentSectionLabel = SETTINGS_NAV.find((n) => n.id === section)?.labelKey ?? "settings.profile";
  const currentSectionMeta = (() => {
    if (lang === "ru") {
      switch (section) {
        case "account":
          return { title: "Аккаунт", description: "Имя, username, био и персональный канал в одном спокойном месте." };
        case "chats":
          return { title: "Настройки чатов", description: "Масштаб текста, язык интерфейса, звуки и визуальные привычки." };
        case "privacy":
          return { title: "Приватность", description: "Кто видит вас, кто может писать первым и кто может приглашать." };
        case "devices":
          return { title: "Устройства", description: "Управляйте активными сессиями и быстрым входом по QR." };
        case "folders":
          return { title: "Папки", description: "Настройте структуру списка чатов и управляйте рабочими категориями." };
        case "premium":
          return { title: "Pingy Premium", description: "Подписка, способы оплаты и реферальный прогресс без визуального шума." };
        default:
          return { title: "Настройки", description: "Основные параметры аккаунта и приложения." };
      }
    }
    switch (section) {
      case "account":
        return { title: "Account", description: "Name, username, bio, and your personal channel in one calm place." };
      case "chats":
        return { title: "Chat settings", description: "Text scale, interface language, sounds, and the way chats feel." };
      case "privacy":
        return { title: "Privacy", description: "Control who sees you, who can message first, and who can invite you." };
      case "devices":
        return { title: "Devices", description: "Manage active sessions and quick QR-based sign-in." };
      case "folders":
        return { title: "Folders", description: "Shape the chat list and manage your working categories." };
      case "premium":
        return { title: "Pingy Premium", description: "Subscription, payment methods, and referral progress without clutter." };
      default:
        return { title: "Settings", description: "Core account and app preferences." };
    }
  })();

  const renderSectionContent = () => {
    if (!user) return null;
    const u = user;
    return (
    <>
{section === "account" && (
            <>
            <div className={SETTINGS_PANEL_CLASS}>
              <div className={SETTINGS_PANEL_HEADER_CLASS}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.profile")}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{currentSectionMeta.description}</p>
                </div>
              </div>

              {/* Avatar + name + username + phone */}
              <div className={SETTINGS_PANEL_BODY_CLASS}>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setShowAvatarModal(true)}
                    className="shrink-0 cursor-pointer block rounded-full border-2 border-dashed border-slate-200 hover:border-blue-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    title={t("settings.manageAvatars")}
                  >
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl overflow-hidden">
                      {u.avatar_url ? (
                        <MediaImage source={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        getAvatarInitials(u.display_name || u.phone)
                      )}
                    </div>
                  </button>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
                          maxLength={50}
                          className="w-full px-3 py-2.5 text-sm font-semibold rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                          placeholder={t("settings.enterName")}
                          autoFocus
                        />
                        {displayName.length >= 40 && (
                          <p className="text-xs text-slate-400">{displayName.length}/50</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={handleSave}
                            disabled={saving || !displayName.trim()}
                            className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                          >
                            {saving ? "..." : t("common.save")}
                          </button>
                          <button
                            onClick={() => { setEditing(false); setDisplayName(u.display_name || ""); setBio(u.bio || ""); }}
                            className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                        {saveMsg && (
                          <p className={`text-xs ${saveMsg === t("common.saved") ? "text-green-600" : "text-red-500"}`}>
                            {saveMsg}
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-slate-800 truncate">
                            {u.display_name || t("settings.noName")}
                          </p>
                          {sub?.is_valid ? (
                            <EmojiPickerPopover
                              value={u.status_emoji ?? ""}
                              onChange={async (emoji) => {
                                try {
                                  const res = await authApi.updateMe({ status_emoji: emoji || undefined });
                                  setUser(res.data);
                                } catch {
                                  // keep previous
                                }
                              }}
                              emptyLabel={t("settings.statusEmojiNone")}
                            >
                              <button
                                type="button"
                                className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-lg border transition-colors ${
                                  u.status_emoji ? "bg-slate-100 border-slate-200 text-slate-700" : "border-dashed border-slate-200 text-slate-400 hover:border-slate-300"
                                }`}
                                title={t("settings.statusEmoji")}
                              >
                                {u.status_emoji || "😊"}
                              </button>
                            </EmojiPickerPopover>
                          ) : (
                            <button
                              type="button"
                              onClick={() => usePremiumModalStore.getState().openModal()}
                              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base text-slate-400 border border-dashed border-slate-200 hover:border-slate-300 hover:text-slate-500 transition-colors"
                              title={t("settings.statusEmoji")}
                            >
                              —
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditing(true)}
                            className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0"
                            title={t("settings.editName")}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                          </button>
                          {saveMsg && (
                            <span className={`text-xs ml-1 ${saveMsg === t("common.saved") ? "text-green-600" : "text-red-500"}`}>
                              {saveMsg}
                            </span>
                          )}
                        </div>
                        {editingUsername ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={username}
                              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30))}
                              maxLength={30}
                              placeholder={t("settings.usernamePlaceholder")}
                              className="w-full px-3 py-2.5 text-sm rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                              style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveUsername}
                                disabled={saving || (username.trim().length > 0 && username.trim().length < 3)}
                                className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                              >
                                {saving ? "..." : t("common.save")}
                              </button>
                              <button
                                onClick={() => { setEditingUsername(false); setUsername(u.username ?? ""); }}
                                className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                            {saveMsg && (
                              <p className={`text-xs ${saveMsg === t("common.saved") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {u.username ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const link = `${window.location.origin}/chats?write=${encodeURIComponent(u.username!)}`;
                                    copyToClipboard(link);
                                    setUsernameShake(true);
                                    setTimeout(() => setUsernameShake(false), 400);
                                    setUsernameCopied(true);
                                    setTimeout(() => setUsernameCopied(false), 2000);
                                  }}
                                  className={`text-sm text-blue-600 truncate hover:underline cursor-pointer text-left ${usernameShake ? "animate-username-shake" : ""}`}
                                  title={t("settings.copyUsernameLink")}
                                >
                                  @{u.username}
                                </button>
                                {usernameCopied && (
                                  <span className="text-xs text-green-600 font-medium shrink-0">{t("common.copied")}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-sm text-slate-400 italic">{t("settings.noUsername")}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => { setUsername(u.username ?? ""); setEditingUsername(true); setSaveMsg(""); }}
                              className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0"
                              title={t("settings.editUsername")}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                            </button>
                          </div>
                        )}
                        {u.short_id != null && (
                          <p className="text-sm text-slate-500" title={t("settings.userId")}>
                            <span className="text-slate-400">{t("settings.userId")}: </span>
                            <span className="font-mono tabular-nums">{u.short_id}</span>
                          </p>
                        )}
                        <p className="text-sm text-slate-500 truncate" title={t("settings.phoneNotEditable")}>
                          {u.phone}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Bio: 60 chars for free, 150 for active subscription (BIO_MAX_PREMIUM) */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                    {t("settings.bio")}
                  </label>
                  {editingBio ? (
                    <div className="space-y-2">
                      <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, sub?.is_valid ? 150 : 60))}
                        maxLength={sub?.is_valid ? 150 : 60}
                        rows={3}
                        placeholder={t("settings.bioPlaceholder")}
                        className="w-full px-3 py-2.5 text-sm rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50 resize-none"
                        style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                      />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs text-slate-400">{bio.length}/{sub?.is_valid ? 150 : 60}</p>
                        <button
                          type="button"
                          onClick={() => usePremiumModalStore.getState().openModal()}
                          className="text-xs text-slate-500 hover:text-blue-600 transition-colors"
                        >
                          {t("settings.bioWithPremium")}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveBio}
                          disabled={saving}
                          className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saving ? "..." : t("common.save")}
                        </button>
                        <button
                          onClick={() => { setEditingBio(false); setBio(u.bio || ""); }}
                          className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <p
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingBio(true)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingBio(true); } }}
                        className="text-sm text-slate-700 whitespace-pre-wrap break-words flex-1 min-w-0 cursor-pointer hover:text-slate-900"
                        title={t("settings.editBio")}
                      >
                        {u.bio ? u.bio : <span className="text-slate-400 italic">{t("settings.bioEmpty")}</span>}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditingBio(true)}
                        className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0"
                        title={t("settings.editBio")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Birthday */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                    {t("settings.birthday")}
                  </label>
                  {editingBirthday ? (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={birthdayHideYear}
                          onChange={(e) => setBirthdayHideYear(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        {t("settings.birthdayWithoutYear")}
                      </label>
                      <input
                        type="date"
                        value={birthday}
                        onChange={(e) => setBirthday(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-2xl border backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                        style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                        placeholder={t("settings.birthdayPlaceholder")}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveBirthday}
                          disabled={saving}
                          className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saving ? "..." : t("common.save")}
                        </button>
                        <button
                          onClick={() => { setEditingBirthday(false); setBirthday(u.birthday || ""); setBirthdayHideYear(Boolean(u.birthday_hide_year)); }}
                          className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <p
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingBirthday(true)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingBirthday(true); } }}
                        className="text-sm text-slate-700 cursor-pointer hover:text-slate-900"
                        title={t("settings.editBirthday")}
                      >
                        {u.birthday
                          ? new Date(u.birthday).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", u.birthday_hide_year ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" })
                          : <span className="text-slate-400 italic">{t("settings.birthdayEmpty")}</span>}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditingBirthday(true)}
                        className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0"
                        title={t("settings.editBirthday")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Personal channel — user adds it manually to profile (not automatic) */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide">
                      {t("settings.personalChannel")}
                    </label>
                    <div ref={personalChannelButtonRef} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowPersonalChannelMenu((v) => !v)}
                        className="p-0.5 text-slate-400 hover:text-slate-600 rounded shrink-0"
                        title={u.personal_channel ? t("settings.editUsername") : t("settings.addChannelToProfile")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 text-xs leading-5 text-slate-500">
                    {t("settings.personalChannelHint")}
                  </p>
                  {showPersonalChannelMenu && (
                    <AnchoredPortal
                      anchorRef={personalChannelButtonRef}
                      portalRef={personalChannelPopoverRef}
                      align="right"
                      minWidth={280}
                      className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_44px_rgba(15,23,42,0.12)]"
                    >
                      <div className="flex flex-col gap-1">
                        <p className="px-3 pb-1 pt-0.5 text-xs leading-5 text-slate-500">
                          {t("settings.personalChannelMenuHint")}
                        </p>
                        {myChannels.length > 0 ? (
                          <>
                            {myChannels.map((ch) => (
                              <button
                                key={ch.id}
                                type="button"
                                onClick={() => handleSetPersonalChannel(ch.id)}
                                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                <span className="min-w-0 truncate">
                                  {ch.title}
                                  {ch.username ? <span className="ml-1 text-slate-400">@{ch.username}</span> : null}
                                </span>
                                {u.personal_channel?.id === ch.id ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sky-600"><path d="M20 6 9 17l-5-5" /></svg>
                                ) : null}
                              </button>
                            ))}
                            {u.personal_channel && (
                              <button
                                type="button"
                                onClick={() => handleSetPersonalChannel(null)}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-slate-50"
                              >
                                {t("settings.removeChannelFromProfile")}
                              </button>
                            )}
                            <div className="my-1 border-t border-slate-100" />
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setShowPersonalChannelMenu(false);
                            setShowCreateChannelModal(true);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-blue-600 transition-colors hover:bg-blue-50"
                        >
                          {t("settings.createChannel")}
                        </button>
                      </div>
                    </AnchoredPortal>
                  )}
                  {u.personal_channel ? (
                    <div className="space-y-1">
                      <div className="flex items-start gap-2 flex-wrap">
                        <Link
                          to={`/channel/${u.personal_channel.id}`}
                          className="text-sm text-blue-600 hover:underline truncate"
                        >
                          {u.personal_channel.title}
                          {u.personal_channel.title_icon && <span className="ml-1 shrink-0" aria-hidden>{u.personal_channel.title_icon}</span>}
                          {u.personal_channel.username && <span className="text-slate-500 ml-1">@{u.personal_channel.username}</span>}
                        </Link>
                      </div>
                      {u.personal_channel.description && (
                        <p className="text-xs text-slate-500 line-clamp-2">{u.personal_channel.description}</p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPersonalChannelMenu((v) => !v)}
                      className="text-sm text-slate-500 hover:text-slate-700"
                    >
                      {t("settings.noChannelInProfile")}
                    </button>
                  )}
                </div>

                {/* Telegram */}
                {u.telegram_username && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-0.5">
                      Telegram
                    </label>
                    <span className="text-slate-800 text-sm">@{u.telegram_username}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Referral program */}
            {u.referral_code && (
              <div className="mt-4">
                <ReferralProgressCard
                  progress={referralProgress}
                  referralLink={`${window.location.origin}/auth?ref=${u.referral_code}`}
                  copied={copied}
                  shake={referralShake}
                  onCopy={handleCopyReferral}
                  t={t}
                  lang={lang}
                />
              </div>
            )}
            </>
            )}

              {section === "chats" && (
            <div className={SETTINGS_PANEL_CLASS}>
              <div className={SETTINGS_PANEL_HEADER_CLASS}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.navChatSettings")}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{currentSectionMeta.description}</p>
                </div>
              </div>
              <div className={SETTINGS_PANEL_BODY_CLASS + " space-y-5"}>
                <div className={SETTINGS_CHATS_SUBCARD_CLASS}>
                  <MessageScaleSlider />
                </div>

                <div className={SETTINGS_CHATS_SUBCARD_CLASS}>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <label className="mb-3 block text-sm font-semibold text-slate-700">
                        {t("settings.messageAlignment")}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setMessageAlignment("left")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            messageAlignment === "left" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {t("settings.messageAlignmentLeft")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setMessageAlignment("right")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            messageAlignment === "right" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {t("settings.messageAlignmentRight")}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-3 block text-sm font-semibold text-slate-700">
                        {t("settings.language")}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setLanguage("en")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            language === "en" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          English
                        </button>
                        <button
                          type="button"
                          onClick={() => setLanguage("ru")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            language === "ru" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          Russian
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-3 block text-sm font-semibold text-slate-700">
                        {t("settings.theme")}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setTheme("light")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            theme === "light" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {t("settings.themeLight")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTheme("dark")}
                          className={`px-3 py-2 rounded-2xl text-sm font-medium transition-all ${
                            theme === "dark" ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {t("settings.themeDark")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sounds */}
                <div className="grid gap-4 lg:grid-cols-[1fr]">
                  <div className={SETTINGS_CHATS_SUBCARD_CLASS}>
                    <label className="mb-3 block text-sm font-semibold text-slate-700">
                      {t("settings.sounds")}
                    </label>
                    <SoundsSection />
                  </div>
                </div>
              </div>
            </div>
              )}

              {section === "privacy" && u && (
            <div className={SETTINGS_PANEL_CLASS}>
              <div className={SETTINGS_PANEL_HEADER_CLASS}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.navPrivacy")}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{currentSectionMeta.description}</p>
                </div>
              </div>
              <div className={SETTINGS_PANEL_BODY_CLASS + " space-y-4"}>
                {saveMsg && (
                  <p className={`text-sm ${saveMsg === t("common.saved") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.privacy")}
                  </label>
                  <div className="space-y-4">
                    {([
                      {
                        key: "show_last_seen",
                        label: t("settings.showLastSeen"),
                        hint: t("settings.showLastSeenHint"),
                        value: (u.show_last_seen === true || u.show_last_seen === "everyone") ? "everyone" : (String(u.show_last_seen) === "contacts" ? "contacts" : "nobody"),
                        options: ["everyone", "nobody", "contacts"],
                        field: "show_last_seen" as const,
                      },
                      {
                        key: "show_phone",
                        label: t("settings.showPhone"),
                        hint: t("settings.showPhoneHint"),
                        value: (u.show_phone === true || u.show_phone === "everyone") ? "everyone" : (String(u.show_phone) === "contacts" ? "contacts" : "nobody"),
                        options: ["everyone", "nobody", "contacts"],
                        field: "show_phone" as const,
                      },
                      {
                        key: "dm_privacy",
                        label: t("settings.dmPrivacy"),
                        hint: t("settings.dmPrivacyHint"),
                        value: (u.dm_privacy === "everyone" || u.dm_privacy === "contacts") ? (u.dm_privacy as "everyone" | "contacts") : "nobody",
                        options: ["everyone", "nobody", "contacts"],
                        field: "dm_privacy" as const,
                      },
                      {
                        key: "add_to_group_privacy",
                        label: t("settings.groupPrivacy"),
                        hint: t("settings.groupPrivacyHint"),
                        value: (u.add_to_group_privacy === "everyone" || u.add_to_group_privacy === "contacts") ? (u.add_to_group_privacy as "everyone" | "contacts") : "nobody",
                        options: ["everyone", "nobody", "contacts"],
                        field: "add_to_group_privacy" as const,
                      },
                    ] as const).map(({ key, label, hint, value, field }) => (
                      <div key={key} className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800">{label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
                        </div>
                        <select
                          value={value}
                          onChange={async (e) => {
                            if (sub?.is_valid !== true) {
                              usePremiumModalStore.getState().openModal();
                              return;
                            }
                            const val = e.target.value as "everyone" | "nobody" | "contacts";
                            const payload: Partial<typeof user> = {};
                            if (field === "show_last_seen" || field === "show_phone") {
                              (payload as Record<string, unknown>)[field] = val;
                            } else {
                              (payload as Record<string, unknown>)[field] = val;
                            }
                            try {
                              const res = await authApi.updateMe(payload);
                              setUser(res.data);
                              setSaveMsg("");
                            } catch (e: unknown) {
                              const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                              setSaveMsg(msg || t("common.saveError"));
                              setTimeout(() => setSaveMsg(""), 5000);
                            }
                          }}
                          className="shrink-0 w-36 py-2 px-3 text-sm border rounded-2xl backdrop-blur focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--text-0)" }}
                        >
                          <option value="everyone">{t("common.everyone")}</option>
                          <option value="nobody">{t("common.nobody")}</option>
                          <option value="contacts">{t("common.contacts")}</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
              )}

              {section === "devices" && (
            <div className={SETTINGS_PANEL_CLASS}>
              <div className={SETTINGS_PANEL_HEADER_CLASS}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.navDevices")}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{currentSectionMeta.description}</p>
                </div>
              </div>
              <div className={SETTINGS_PANEL_BODY_CLASS + " space-y-6"}>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowQrLoginModal(true)}
                    className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    {t("settings.qrLogin")}
                  </button>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.activeSessions")}
                  </label>
                  <SessionsSection />
                </div>
              </div>
            </div>
              )}

              {section === "folders" && (
            <div className={SETTINGS_PANEL_CLASS}>
              <div className={SETTINGS_PANEL_HEADER_CLASS}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.navFolders")}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{currentSectionMeta.description}</p>
                </div>
              </div>
              <div className={SETTINGS_PANEL_BODY_CLASS}>
                <FoldersSection t={t} onFoldersUpdated={onFoldersUpdated} hasSubscription={sub?.is_valid === true} />
              </div>
            </div>
              )}

              {section === "premium" && (
            <div className="space-y-6" ref={subscriptionPlansRef}>
              {u.referral_code && (
                <ReferralProgressCard
                  progress={referralProgress}
                  referralLink={`${window.location.origin}/auth?ref=${u.referral_code}`}
                  copied={copied}
                  shake={referralShake}
                  onCopy={handleCopyReferral}
                  t={t}
                  lang={lang}
                />
              )}

              {/* Subscription: status + buy/gift (без отдельной шапки панели) */}
              <div className={SETTINGS_PANEL_CLASS}>
                <div className={SETTINGS_PANEL_BODY_CLASS + " space-y-4"}>
                  {/* Buy or gift; статус + «Способы оплаты» в одной строке */}
                  <SubscriptionPlansBlock
                    plans={plans}
                    subLoading={subLoading}
                    onSubscribe={handleSubscribe}
                    paymentError={paymentError}
                    initialGiftRecipient={initialGiftRecipient}
                    onOpenPaymentMethods={() => setShowPaymentMethodsModal(true)}
                    subscriptionSummary={
                      sub
                        ? {
                            status: sub.status || "",
                            is_valid: sub.is_valid,
                            current_period_end: sub.current_period_end,
                          }
                        : undefined
                    }
                    t={t}
                    lang={lang}
                  />
                </div>
              </div>

            </div>
              )}
    </>
  );
  };

  const content = (
    <div className={embed ? "flex h-full overflow-hidden" : "flex flex-col min-h-screen ui-surface-0"}>
        {showAvatarModal && user && (
          <AvatarManagerModal
            avatars={user.avatars ?? []}
            onClose={() => setShowAvatarModal(false)}
            onUpdated={() => {}}
            onUserUpdate={handleAvatarModalUpdated}
          />
        )}
        {showCreateChannelModal && (
          <CreateChannelModal
            isOpen={showCreateChannelModal}
            onClose={() => setShowCreateChannelModal(false)}
            onCreated={() => { handleChannelCreated(); setShowCreateChannelModal(false); }}
          />
        )}
        {showQrLoginModal && (
          <QrLoginModal isOpen={showQrLoginModal} onClose={() => setShowQrLoginModal(false)} />
        )}
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => setShowPaymentMethodsModal(false)}
          onAddCard={() => subscriptionPlansRef.current?.scrollIntoView({ behavior: "smooth" })}
        />
        <SupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
        {loading && (
          <div className="flex items-center justify-center flex-1 p-8">
            <p className="text-slate-500">{t("common.loading")}</p>
          </div>
        )}

        {errorToast && (
          <TopLayerPortal>
            <div
              role="alert"
              className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 bg-red-600 text-white text-sm rounded-lg shadow-lg max-w-md"
              style={{ zIndex: TOP_LAYER_Z_INDEX }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="flex-1 min-w-0">{errorToast}</span>
              {error && (
                <button
                  type="button"
                  onClick={() => { setErrorToast(""); setError(""); loadProfile(); }}
                  className="shrink-0 px-3 py-1.5 rounded-md bg-white/20 hover:bg-white/30 font-medium"
                >
                  {t("common.retry")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorToast("")}
                className="shrink-0 p-1 rounded hover:bg-white/20"
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </TopLayerPortal>
        )}

        {!loading && (user || error) && (
          <div ref={desktopLayoutRef} className={`relative flex flex-1 min-h-0 ${embed ? "" : "container mx-auto max-w-5xl"}`}>
            {/* ===== Mobile: block list (step 1) ===== */}
            {isMobile && !mobileShowContent && (
              <div className="flex flex-col flex-1 min-w-0 w-full md:hidden ui-surface-1 overflow-y-auto">
                <div className={`flex flex-col flex-1 min-h-0 ${embed ? "p-4" : "p-4 sm:p-6"}`}>
                  <div
                    className="-mx-4 sm:-mx-6 px-4 sm:px-6 sticky top-0 z-20 h-16 flex items-center border-b backdrop-blur"
                    style={{ top: "env(safe-area-inset-top)", background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
                  >
                    <h2 className="text-base font-semibold truncate" style={{ color: "var(--text-0)" }}>
                      {t("settings.settingsTitle")}
                    </h2>
                  </div>
                  <div className="h-4" />
                  <div className={SETTINGS_NAV_SHELL_CLASS}>
                    <SettingsNav section={section} onSection={handleSectionSelect} t={t} />
                  {user?.is_staff && (
                    <div className="mt-4 border-t border-slate-100 px-1 pt-4">
                      <Link
                        to="/admin"
                        className={`${SETTINGS_NAV_ACTION_CLASS} text-blue-600 hover:bg-blue-50/80`}
                      >
                        Админ-панель
                      </Link>
                    </div>
                  )}
                  <div className="mt-auto border-t border-slate-100 px-1 pt-4">
                    <p className="px-3 py-2 text-xs text-slate-400">
                      {t("settings.version")} {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"}
                    </p>
                    <div className="mt-1 flex flex-col gap-2">
                      <button
                        onClick={() => setShowSupportModal(true)}
                        className={`${SETTINGS_NAV_ACTION_CLASS} text-slate-600 hover:bg-white/80`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                        {t("support.menu")}
                      </button>
                      <button
                        onClick={() => setShowLogoutConfirm(true)}
                        className={`${SETTINGS_NAV_ACTION_CLASS} text-red-600 hover:bg-red-50/80`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        {t("common.logout")}
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===== Mobile: section content with back (step 2) ===== */}
            {isMobile && mobileShowContent && (
              <div className="flex flex-col flex-1 min-w-0 w-full md:hidden overflow-hidden">
                <div
                  className="sticky top-0 z-20 shrink-0 border-b backdrop-blur px-4 h-16 flex items-center gap-3"
                  style={{ top: "env(safe-area-inset-top)", background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
                >
                  <button
                    type="button"
                    onClick={() => setMobileShowContent(false)}
                    className="flex items-center gap-1 -ml-1 p-2 rounded-xl hover:bg-slate-100/70 transition-colors"
                    style={{ color: "var(--text-1)" }}
                    aria-label={t("common.back")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <span className="font-semibold truncate" style={{ color: "var(--text-0)" }}>{t(currentSectionLabel)}</span>
                </div>
                <main ref={mainContentRef} className={`flex-1 min-w-0 overflow-y-auto ${embed ? "p-4" : "p-4 sm:p-6"}`}>
                  <div>
                    {renderSectionContent()}
                  </div>
                </main>
              </div>
            )}

            {/* ===== Desktop: two columns ===== */}
            <aside className={`hidden md:flex shrink-0 ${desktopUseOverlay ? "border-r-0" : "border-r"} ui-border-subtle ui-surface-1 flex-col ${embed ? "w-[17rem] p-3.5" : "w-[18rem] p-4"}`}>
              <div className={SETTINGS_NAV_SHELL_CLASS}>
                <SettingsNav section={section} onSection={handleSectionSelect} t={t} />
                {user?.is_staff && (
                  <div className="mt-4 border-t border-slate-100 px-1 pt-4">
                  <Link
                    to="/admin"
                    className={`${SETTINGS_NAV_ACTION_CLASS} text-blue-600 hover:bg-blue-50/80`}
                  >
                    Админ-панель
                  </Link>
                </div>
              )}
                <div className="mt-auto border-t border-slate-100 px-1 pt-4">
                  <p className="px-3 py-2 text-xs text-slate-400">
                  {t("settings.version")} {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"}
                </p>
                  <div className="mt-1 flex flex-col gap-2">
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className={`${SETTINGS_NAV_ACTION_CLASS} text-slate-600 hover:bg-white/80`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    {t("support.menu")}
                  </button>
                  <button
                    onClick={() => setShowLogoutConfirm(true)}
                    className={`${SETTINGS_NAV_ACTION_CLASS} text-red-600 hover:bg-red-50/80`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    {t("common.logout")}
                  </button>
                </div>
              </div>
              </div>
            </aside>

            {/* ===== Desktop: Section content ===== */}
            {!desktopUseOverlay && (
            <main ref={mainContentRef} className={`hidden md:block flex-1 min-w-0 overflow-y-auto ui-surface-1 ${embed ? "p-4" : "p-6"}`}>
              <div>
                {renderSectionContent()}
              </div>
            </main>
            )}

            {desktopUseOverlay && desktopShowContent && (
              <div className="hidden md:flex absolute inset-0 z-20 ui-overlay items-stretch justify-end">
                <div className="flex h-full w-full flex-col ui-surface-1 shadow-[0_24px_80px_rgba(2,6,23,0.28)]">
                  <div
                    className="sticky top-0 z-20 shrink-0 border-b backdrop-blur px-5 h-16 flex items-center gap-3"
                    style={{ background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setDesktopShowContent(false)}
                      className="flex items-center gap-1 -ml-1 p-2 rounded-xl hover:bg-slate-100/70 transition-colors"
                      style={{ color: "var(--text-1)" }}
                      aria-label={t("common.back")}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="font-semibold truncate" style={{ color: "var(--text-0)" }}>{t(currentSectionLabel)}</span>
                  </div>
                  <main ref={mainContentRef} className={`flex-1 min-w-0 overflow-y-auto ${embed ? "p-4" : "p-6"}`}>
                    <div className="settings-section-fade-in">
                      {renderSectionContent()}
                    </div>
                  </main>
                </div>
              </div>
            )}
          </div>
        )}
      <ConfirmModal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        message={t("common.logoutConfirm")}
        onConfirm={handleLogout}
        variant="danger"
        confirmText={t("common.logout")}
      />
    </div>
  );

  if (embed) return content;

  return (
    <div className="min-h-screen ui-surface-0">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
      >
        <div className="container mx-auto px-4 h-16 flex justify-between items-center">
          <Link to="/chats" className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>
            Личный кабинет
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/chats" className="text-sm font-medium hover:underline" style={{ color: "var(--text-1)" }}>
              Мои чаты
            </Link>
          </div>
        </div>
      </header>
      <main>{content}</main>
    </div>
  );
}
