import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPermission, requestPermission, NOTIFICATIONS_SUPPORTED, type NotificationPermission } from "../lib/notifications";
import { authApi, paymentsApi, type User, type SubscriptionStatus, type StarsBalance } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore, MESSAGE_TEXT_SCALES } from "../store/preferences";
import { getAvatarInitials } from "../lib/avatar-initials";
import { AvatarManagerModal } from "../components/AvatarManagerModal";

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

const STATUS_LABELS: Record<string, string> = {
  trial: "Пробный период",
  active: "Активна",
  past_due: "Просрочена",
  cancelled: "Не активна",
};

const REASON_LABELS: Record<string, string> = {
  referral_inviter: "Пригласил пользователя",
  referral_invitee: "Регистрация по ссылке",
  chat_expansion: "Расширение чата",
  admin_grant: "Бонус",
};

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
      .catch(() => setError("Не удалось загрузить профиль"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await authApi.updateMe({ display_name: displayName });
      setUser(res.data);
      setEditing(false);
      setSaveMsg("Сохранено");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg("Ошибка сохранения");
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
      setError(detail || "Ошибка оплаты");
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
        {loading && <p className="text-slate-500">Загрузка...</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && user && (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* ===== Верх / левая колонка: Профиль ===== */}
            <div className="flex-1 min-w-0 order-1">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden lg:sticky lg:top-4">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">Профиль</h2>
              </div>

              {/* Avatar + name */}
              <div className="p-5 flex items-center gap-4 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAvatarModal(true)}
                  className="shrink-0 cursor-pointer block rounded-full border-2 border-dashed border-slate-200 hover:border-blue-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                  title="Управление аватарками"
                >
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl overflow-hidden">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      getAvatarInitials(user.display_name || user.phone)
                    )}
                  </div>
                </button>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">
                    {user.display_name || "Без имени"}
                  </p>
                  <p className="text-sm text-slate-500 truncate">{user.phone}</p>
                </div>
              </div>

              {/* Fields */}
              <div className="p-5 space-y-4">
                {/* Display name */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Отображаемое имя
                  </label>
                  {editing ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Введите имя"
                      />
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? "..." : "Сохранить"}
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          setDisplayName(user.display_name || "");
                        }}
                        className="text-slate-500 hover:text-slate-700 px-3 py-2 text-sm"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-800 text-sm">
                        {user.display_name || "—"}
                      </span>
                      <button
                        onClick={() => setEditing(true)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Изменить
                      </button>
                    </div>
                  )}
                  {saveMsg && (
                    <p className={`text-xs mt-1 ${saveMsg === "Сохранено" ? "text-green-600" : "text-red-500"}`}>
                      {saveMsg}
                    </p>
                  )}
                </div>

                {/* Phone (read-only) */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Телефон
                  </label>
                  <span className="text-slate-800 text-sm">{user.phone || "—"}</span>
                </div>

                {/* Telegram */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Telegram
                  </label>
                  <span className="text-slate-800 text-sm">
                    {user.telegram_username ? `@${user.telegram_username}` : "Не привязан"}
                  </span>
                </div>

                {/* Масштаб текста в сообщениях */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Масштаб текста в сообщениях
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      [0.85, "Маленький"],
                      [0.9, "Уменьшенный"],
                      [1, "Обычный"],
                      [1.1, "Крупный"],
                    ] as const).map(([scale, label]) => (
                      <ScaleButton key={scale} scale={scale} label={label} />
                    ))}
                  </div>
                </div>

                {/* Уведомления в браузере */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Уведомления о новых сообщениях
                  </label>
                {/* Language */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Language
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
                    Theme
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        theme === "light" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        theme === "dark" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      Dark
                    </button>
                  </div>
                </div>

                  {!NOTIFICATIONS_SUPPORTED ? (
                    <p className="text-sm text-slate-500">Ваш браузер не поддерживает уведомления.</p>
                  ) : notifPermission === "granted" ? (
                    <p className="text-sm text-green-600">Уведомления включены</p>
                  ) : notifPermission === "denied" ? (
                    <p className="text-sm text-slate-500">Уведомления заблокированы. Разрешите их в настройках браузера для этого сайта.</p>
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
                        {notifRequesting ? "Запрос…" : "Включить уведомления"}
                      </button>
                      <span className="text-xs text-slate-500">Появится запрос браузера</span>
                    </div>
                  )}
                </div>

                {/* Приватность: показ времени последнего захода */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Приватность
                  </label>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-800">Показывать время последнего захода</p>
                      <p className="text-xs text-slate-500">Если выключено, другие увидят «был(а) в сети недавно»</p>
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
                </div>
              </div>

              {/* Logout */}
              <div className="p-5 border-t border-slate-100">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти из аккаунта
                </button>
              </div>
            </div>
            </div>

            {/* ===== Правая колонка: Подписка и реферальная история ===== */}
            <div className="w-full lg:w-80 shrink-0 space-y-6 order-2">
              {/* Подписка */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h2 className="text-lg font-semibold text-slate-800">Подписка</h2>
                </div>
                <div className="p-5 space-y-3">
                  {sub ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Статус</span>
                        <span className={`text-sm font-medium ${sub.is_valid ? "text-green-600" : "text-red-500"}`}>
                          {STATUS_LABELS[sub.status || ""] || "Нет подписки"}
                        </span>
                      </div>
                      {sub.current_period_end && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">Действует до</span>
                          <span className="text-sm text-slate-800">
                            {new Date(sub.current_period_end).toLocaleDateString("ru-RU")}
                          </span>
                        </div>
                      )}
                      {sub.is_referral_trial && (
                        <p className="text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                          Расширенная триалка (2 недели) по реферальной ссылке
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Стоимость</span>
                        <span className="text-sm text-slate-800">{sub.price_rub} руб./мес.</span>
                      </div>
                      {!sub.is_valid && (
                        <button
                          onClick={handleSubscribe}
                          disabled={subLoading}
                          className="w-full mt-2 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                        >
                          {subLoading ? "Переход к оплате..." : `Оформить подписку — ${sub.price_rub} руб./мес.`}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">
                        Подписка не оформлена. Стоимость: <strong>300 руб./мес.</strong>
                      </p>
                      <button
                        onClick={handleSubscribe}
                        disabled={subLoading}
                        className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                      >
                        {subLoading ? "Переход к оплате..." : "Оформить подписку — 300 руб./мес."}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Звёзды и реферальная история */}
              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl border border-amber-200 overflow-hidden">
                <div className="p-5 border-b border-amber-100 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-amber-900 flex items-center gap-2">
                    <span className="text-2xl">&#9733;</span> Звёзды
                  </h2>
                  <span className="text-2xl font-bold text-amber-600">⭐ {stars}</span>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-amber-800">
                    Приглашайте друзей — вы оба получаете <strong>⭐ 10 звёзд</strong>.
                    За <strong>⭐ 50 звёзд</strong> — прокачать чат до 100 участников, за <strong>⭐ 100 звёзд</strong> — до 1000 (раз и навсегда).
                  </p>
                  {starsData && starsData.transactions.length > 0 && (
                    <div className="mt-3">
                      <h3 className="text-sm font-medium text-amber-800 mb-2">История операций</h3>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {starsData.transactions.map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-sm">
                            <span className="text-amber-700 truncate flex-1">
                              {REASON_LABELS[t.reason] || t.reason}
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

              {/* Реферальная программа */}
              {user.referral_code && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-100">
                    <h2 className="text-lg font-semibold text-slate-800">Реферальная программа</h2>
                  </div>
                  <div className="p-5 space-y-3">
                    <p className="text-sm text-slate-600">
                      Пригласите друга — он получит <strong>2 недели бесплатно</strong> и <strong>⭐ 10 звёзд</strong>,
                      а вы — тоже <strong>⭐ 10 звёзд</strong>.
                    </p>
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
                        {copied ? "Скопировано!" : "Копировать"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
          <Link to="/dashboard" className="text-xl font-semibold text-slate-800">
            Личный кабинет
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-slate-600 hover:text-slate-900 text-sm font-medium">
              Мои чаты
            </Link>
          </div>
        </div>
      </header>
      <main>{content}</main>
    </div>
  );
}
