import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPermission, requestPermission, NOTIFICATIONS_SUPPORTED, type NotificationPermission } from "../lib/notifications";
import { authApi, paymentsApi, e2eeApi, sessionsApi, type User, type SubscriptionStatus, type StarsBalance, type E2eeDevice, type UserSessionInfo } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore, MESSAGE_TEXT_SCALES } from "../store/preferences";
import { getAvatarInitials } from "../lib/avatar-initials";
import { toSameOriginMediaUrl } from "../lib/media-url";
import { AvatarManagerModal } from "../components/AvatarManagerModal";
import { useTranslation, t as tFn, getLocale, type AppLanguage } from "../lib/i18n";

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

function getReasonLabel(reason: string, lang: AppLanguage): string {
  if (reason === "referral_inviter") return tFn("reason.referral_inviter", lang);
  if (reason === "referral_invitee") return tFn("reason.referral_invitee", lang);
  if (reason === "chat_expansion") return tFn("reason.chat_expansion", lang);
  if (reason === "admin_grant") return tFn("reason.admin_grant", lang);
  return reason;
}

function E2eeDevicesSection() {
  const { t, lang } = useTranslation();
  const [devices, setDevices] = useState<E2eeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    e2eeApi.listDevices()
      .then((r) => setDevices(r.data))
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  if (devices.length === 0) return <p className="text-sm text-slate-500">{t("settings.noDevices")}</p>;
  return (
    <div className="space-y-2">
      {devices.map((d) => (
        <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 border border-slate-200">
          <div>
            <p className="text-sm font-medium text-slate-800">{d.name || `${t("settings.unknownDevice")} ${d.device_id}`}</p>
            <p className="text-xs text-slate-500">ID: {d.device_id} · {new Date(d.last_active_at).toLocaleDateString(getLocale(lang))}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setRemoving(d.id);
              try {
                await e2eeApi.removeDevice(d.id);
                setDevices((prev) => prev.filter((x) => x.id !== d.id));
              } catch {}
              setRemoving(null);
            }}
            disabled={removing === d.id}
            className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {removing === d.id ? "…" : t("settings.endSession")}
          </button>
        </div>
      ))}
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
          className={`flex items-center justify-between py-2.5 px-3 rounded-lg border ${
            s.is_current
              ? "bg-blue-50 border-blue-200"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-800 truncate">
                {s.device_label || t("settings.unknownDevice")}
              </p>
              {s.is_current && (
                <span className="shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                  {t("settings.currentSession")}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-800">{t("settings.enableSounds")}</p>
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            soundEnabled ? "bg-blue-600" : "bg-slate-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              soundEnabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {soundEnabled && (
        <div className="space-y-3 pl-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{t("settings.soundSend")}</span>
            <button
              type="button"
              onClick={() => setSoundSend(!soundSend)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                soundSend ? "bg-blue-600" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  soundSend ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{t("settings.soundReceive")}</span>
            <button
              type="button"
              onClick={() => setSoundReceive(!soundReceive)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                soundReceive ? "bg-blue-600" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  soundReceive ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{t("settings.soundMention")}</span>
            <button
              type="button"
              onClick={() => setSoundMention(!soundMention)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                soundMention ? "bg-blue-600" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  soundMention ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScaleButton({ scale, label }: { scale: (typeof MESSAGE_TEXT_SCALES)[number]; label: string }) {
  const current = usePreferencesStore((s) => s.messageTextScale);
  const setScale = usePreferencesStore((s) => s.setMessageTextScale);
  const isActive = Number(current) === Number(scale);
  return (
    <button
      type="button"
      onClick={() => setScale(scale)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

export default function SettingsPage({ embed = false }: { embed?: boolean }) {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const clearTokens = useAuthStore((s) => s.clearTokens);
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [starsData, setStarsData] = useState<StarsBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* edit state */
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  /* subscription */
  const [subLoading, setSubLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  /* notifications */
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(NOTIFICATIONS_SUPPORTED ? getPermission() : null);
  const [notifRequesting, setNotifRequesting] = useState(false);

  useEffect(() => {
    Promise.all([authApi.me(), paymentsApi.getSubscription(), paymentsApi.getStars()])
      .then(([userRes, subRes, starsRes]) => {
        setUser(userRes.data);
        setDisplayName(userRes.data.display_name || "");
        setSub(subRes.data);
        setStarsData(starsRes.data);
      })
      .catch(() => setError(t("settings.loadProfileError")))
      .finally(() => setLoading(false));
  }, []);

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

  const handleAvatarModalUpdated = () => {
    authApi.me().then((res) => setUser(res.data));
  };

  const handleSubscribe = async () => {
    setSubLoading(true);
    try {
      const returnUrl = window.location.origin + window.location.pathname + "?paid=1";
      const { data } = await paymentsApi.subscribe(returnUrl);
      if (data.confirmation_url) {
        window.location.href = data.confirmation_url;
        return;
      }
      const subRes = await paymentsApi.getSubscription();
      setSub(subRes.data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || t("settings.paymentError"));
    } finally {
      setSubLoading(false);
    }
  };

  const handleCopyReferral = () => {
    if (!user?.referral_code) return;
    const link = `${window.location.origin}/auth?ref=${user.referral_code}`;
    copyToClipboard(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = () => {
    clearTokens();
    navigate("/auth");
  };

  const stars = starsData?.stars ?? sub?.stars ?? 0;

  const content = (
    <div className={embed ? "p-4 overflow-y-auto h-full" : "container mx-auto px-4 py-8 max-w-4xl"}>
        {showAvatarModal && (
          <AvatarManagerModal
            avatars={user?.avatars ?? []}
            onClose={() => setShowAvatarModal(false)}
            onUpdated={() => {}}
            onUserUpdate={handleAvatarModalUpdated}
          />
        )}
        {loading && <p className="text-slate-500">{t("common.loading")}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && user && (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* ===== Верх / левая колонка: Профиль + Настройки ===== */}
            <div className="flex-1 min-w-0 order-1 space-y-6">

            {/* ======== Блок 1: Профиль ======== */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">{t("settings.profile")}</h2>
              </div>

              {/* Avatar + name + username + phone */}
              <div className="p-5">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setShowAvatarModal(true)}
                    className="shrink-0 cursor-pointer block rounded-full border-2 border-dashed border-slate-200 hover:border-blue-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    title={t("settings.manageAvatars")}
                  >
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl overflow-hidden">
                      {user.avatar_url ? (
                        <img src={toSameOriginMediaUrl(user.avatar_url)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        getAvatarInitials(user.display_name || user.phone)
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
                          className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                            onClick={() => { setEditing(false); setDisplayName(user.display_name || ""); }}
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
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-slate-800 truncate">
                            {user.display_name || t("settings.noName")}
                          </p>
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
                        {user.username && (
                          <p className="text-sm text-blue-600 truncate">@{user.username}</p>
                        )}
                        <p className="text-sm text-slate-500 truncate">{user.phone}</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Telegram */}
                {user.telegram_username && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-0.5">
                      Telegram
                    </label>
                    <span className="text-slate-800 text-sm">@{user.telegram_username}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ======== Блок 2: Настройки ======== */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">{t("settings.settingsTitle")}</h2>
              </div>

              <div className="p-5 space-y-4">
                {/* Масштаб текста в сообщениях */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.messageTextScale")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      [0.85, "settings.scaleSmall"],
                      [0.9, "settings.scaleReduced"],
                      [1, "settings.scaleNormal"],
                      [1.1, "settings.scaleLarge"],
                    ] as const).map(([scale, labelKey]) => (
                      <ScaleButton key={scale} scale={scale} label={t(labelKey)} />
                    ))}
                  </div>
                </div>

                {/* Уведомления в браузере */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.notifications")}
                  </label>
                {/* Language */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.language")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setLanguage("en")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        language === "en" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      English
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage("ru")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        language === "ru" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      Russian
                    </button>
                  </div>
                </div>

                {/* Theme */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.theme")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        theme === "light" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {t("settings.themeLight")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        theme === "dark" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {t("settings.themeDark")}
                    </button>
                  </div>
                </div>

                  {!NOTIFICATIONS_SUPPORTED ? (
                    <p className="text-sm text-slate-500">{t("settings.notifNotSupported")}</p>
                  ) : notifPermission === "granted" ? (
                    <p className="text-sm text-green-600">{t("settings.notifEnabled")}</p>
                  ) : notifPermission === "denied" ? (
                    <p className="text-sm text-slate-500">{t("settings.notifBlocked")}</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setNotifRequesting(true);
                          const p = await requestPermission();
                          setNotifPermission(p);
                          setNotifRequesting(false);
                        }}
                        disabled={notifRequesting}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {notifRequesting ? t("settings.notifRequest") : t("settings.notifEnable")}
                      </button>
                      <span className="text-xs text-slate-500">{t("settings.notifBrowserPrompt")}</span>
                    </div>
                  )}
                </div>

                {/* Звуки уведомлений */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.sounds")}
                  </label>
                  <SoundsSection />
                </div>

                {/* Активные сессии */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.activeSessions")}
                  </label>
                  <SessionsSection />
                </div>

                {/* E2EE устройства */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.e2eeDevices")}
                  </label>
                  <E2eeDevicesSection />
                </div>

                {/* Приватность: показ времени последнего захода и номера телефона */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    {t("settings.privacy")}
                  </label>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-800">{t("settings.showLastSeen")}</p>
                        <p className="text-xs text-slate-500">{t("settings.showLastSeenHint")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !user.show_last_seen;
                          try {
                            const res = await authApi.updateMe({ show_last_seen: newVal } as Partial<typeof user>);
                            setUser(res.data);
                          } catch { /* ignore */ }
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          user.show_last_seen !== false ? "bg-blue-600" : "bg-slate-200"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            user.show_last_seen !== false ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-800">{t("settings.showPhone")}</p>
                        <p className="text-xs text-slate-500">{t("settings.showPhoneHint")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !user.show_phone;
                          try {
                            const res = await authApi.updateMe({ show_phone: newVal } as Partial<typeof user>);
                            setUser(res.data);
                          } catch { /* ignore */ }
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          user.show_phone !== false ? "bg-blue-600" : "bg-slate-200"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            user.show_phone !== false ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    <div>
                      <p className="text-sm text-slate-800 mb-2">{t("settings.dmPrivacy")}</p>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="dm_privacy"
                            checked={user.dm_privacy !== "nobody"}
                            onChange={async () => {
                              if (user.dm_privacy === "nobody") {
                                try {
                                  const res = await authApi.updateMe({ dm_privacy: "everyone" } as Partial<typeof user>);
                                  setUser(res.data);
                                } catch { /* ignore */ }
                              }
                            }}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{t("common.everyone")}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="dm_privacy"
                            checked={user.dm_privacy === "nobody"}
                            onChange={async () => {
                              if (user.dm_privacy !== "nobody") {
                                try {
                                  const res = await authApi.updateMe({ dm_privacy: "nobody" } as Partial<typeof user>);
                                  setUser(res.data);
                                } catch { /* ignore */ }
                              }
                            }}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{t("common.nobody")}</span>
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{t("settings.dmPrivacyHint")}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-800 mb-2">{t("settings.groupPrivacy")}</p>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="add_to_group_privacy"
                            checked={user.add_to_group_privacy !== "nobody"}
                            onChange={async () => {
                              if (user.add_to_group_privacy === "nobody") {
                                try {
                                  const res = await authApi.updateMe({ add_to_group_privacy: "everyone" } as Partial<typeof user>);
                                  setUser(res.data);
                                } catch { /* ignore */ }
                              }
                            }}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{t("common.everyone")}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="add_to_group_privacy"
                            checked={user.add_to_group_privacy === "nobody"}
                            onChange={async () => {
                              if (user.add_to_group_privacy !== "nobody") {
                                try {
                                  const res = await authApi.updateMe({ add_to_group_privacy: "nobody" } as Partial<typeof user>);
                                  setUser(res.data);
                                } catch { /* ignore */ }
                              }
                            }}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{t("common.nobody")}</span>
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{t("settings.groupPrivacyHint")}</p>
                    </div>
                  </div>
                </div>
              </div>

              </div>

            {/* Logout — compact */}
            <div className="flex justify-start">
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {t("common.logout")}
              </button>
            </div>

            </div>

            {/* ===== Правая колонка: Подписка и реферальная история ===== */}
            <div className="w-full lg:w-80 shrink-0 space-y-6 order-2">
              {/* Подписка */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.subscription")}</h2>
                </div>
                <div className="p-5 space-y-3">
                  {sub ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">{t("settings.status")}</span>
                        <span className={`text-sm font-medium ${sub.is_valid ? "text-green-600" : "text-red-500"}`}>
                          {getStatusLabel(sub.status || "", lang)}
                        </span>
                      </div>
                      {sub.current_period_end && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">{t("settings.validUntil")}</span>
                          <span className="text-sm text-slate-800">
                            {new Date(sub.current_period_end).toLocaleDateString(getLocale(lang))}
                          </span>
                        </div>
                      )}
                      {sub.is_referral_trial && (
                        <p className="text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                          {t("settings.referralTrial")}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">{t("settings.price")}</span>
                        <span className="text-sm text-slate-800">{sub.price_rub} {t("sub.pricePerMonth")}</span>
                      </div>
                      {!sub.is_valid && (
                        <button
                          onClick={handleSubscribe}
                          disabled={subLoading}
                          className="w-full mt-2 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                        >
                          {subLoading ? t("settings.goToPayment") : `${t("sub.subscribe")} — ${sub.price_rub} ${t("sub.pricePerMonth")}`}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: t("sub.noSubDesc") }} />
                      <button
                        onClick={handleSubscribe}
                        disabled={subLoading}
                        className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                      >
                        {subLoading ? t("settings.goToPayment") : `${t("sub.subscribe")} — 300 ${t("sub.pricePerMonth")}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Реферальная программа — над звёздами */}
              {user.referral_code && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-100">
                    <h2 className="text-lg font-semibold text-slate-800">{t("settings.referral")}</h2>
                  </div>
                  <div className="p-5 space-y-3">
                    <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: t("settings.referralDesc") }} />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/auth?ref=${user.referral_code}`}
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700 min-w-0"
                      />
                      <button
                        onClick={handleCopyReferral}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors shrink-0"
                      >
                        {copied ? t("common.copied") : t("common.copy")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Звёзды и история операций */}
              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl border border-amber-200 overflow-hidden">
                <div className="p-5 border-b border-amber-100 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-amber-900 flex items-center gap-2">
                    <span className="text-2xl">&#9733;</span> {t("settings.stars")}
                  </h2>
                  <span className="text-2xl font-bold text-amber-600">⭐ {stars}</span>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-amber-800" dangerouslySetInnerHTML={{ __html: t("settings.starsDesc") }} />
                  {starsData && starsData.transactions.length > 0 && (
                    <div className="mt-3">
                      <h3 className="text-sm font-medium text-amber-800 mb-2">{t("settings.transactionHistory")}</h3>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {starsData.transactions.map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-sm">
                            <span className="text-amber-700 truncate flex-1">
                              {getReasonLabel(t.reason, lang)}
                            </span>
                            <span className={`font-medium ml-2 ${t.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                              {t.amount > 0 ? "+" : ""}⭐ {t.amount}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  if (embed) return content;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link to="/chats" className="text-xl font-semibold text-slate-800">
            Личный кабинет
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/chats" className="text-slate-600 hover:text-slate-900 text-sm font-medium">
              Мои чаты
            </Link>
          </div>
        </div>
      </header>
      <main>{content}</main>
    </div>
  );
}
