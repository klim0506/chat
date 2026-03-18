import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  adminApi,
  type AdminStats,
  type TrackingLinkItem,
  type TrackingLinkClickItem,
  type FeedbackItem,
} from "../api/client";
import { useAuthStore } from "../store/auth";

const PLATFORM_COLORS: Record<string, string> = {
  web: "#3b82f6",
  desktop: "#10b981",
  android: "#f59e0b",
  unknown: "#94a3b8",
};

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [links, setLinks] = useState<TrackingLinkItem[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [createTag, setCreateTag] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createTargetUrl, setCreateTargetUrl] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [expandedClicksId, setExpandedClicksId] = useState<string | null>(null);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackFilter, setFeedbackFilter] = useState<"" | "feedback" | "support">("");
  const [clicksData, setClicksData] = useState<{
    clicks: TrackingLinkClickItem[];
    total: number;
  } | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [linkCopyShakeId, setLinkCopyShakeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/auth", { replace: true });
      return;
    }
    adminApi
      .getStats()
      .then((r) => {
        setStats(r.data);
        setStatsError(null);
      })
      .catch((e) => {
        if (e.response?.status === 403) {
          navigate("/chats", { replace: true });
          return;
        }
        setStatsError("Не удалось загрузить статистику");
      });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    adminApi
      .getTrackingLinks()
      .then((r) => setLinks(r.data))
      .catch(() => setLinks([]))
      .finally(() => setLinksLoading(false));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setFeedbackLoading(true);
    const params = feedbackFilter ? { type: feedbackFilter, limit: 100 } : { limit: 100 };
    adminApi
      .getFeedback(params)
      .then((r) => setFeedbackList(r.data))
      .catch(() => setFeedbackList([]))
      .finally(() => setFeedbackLoading(false));
  }, [isAuthenticated, feedbackFilter]);

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    if (!createTag.trim() || !createTargetUrl.trim()) {
      setCreateError("Заполните метку и URL");
      return;
    }
    setCreateSubmitting(true);
    try {
      const { data } = await adminApi.createTrackingLink({
        tag: createTag.trim(),
        slug: createSlug.trim() || undefined,
        target_url: createTargetUrl.trim(),
      });
      setLinks((prev) => [data, ...prev]);
      setCreateTag("");
      setCreateSlug("");
      setCreateTargetUrl("");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCreateError(detail || "Ошибка создания");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDeleteLink = async (id: string) => {
    if (!confirm("Удалить ссылку?")) return;
    try {
      await adminApi.deleteTrackingLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      if (expandedClicksId === id) setExpandedClicksId(null);
    } catch {
      /* ignore */
    }
  };

  const handleShowClicks = (id: string) => {
    if (expandedClicksId === id) {
      setExpandedClicksId(null);
      setClicksData(null);
      return;
    }
    setExpandedClicksId(id);
    adminApi.getTrackingLinkClicks(id, 100).then((r) => setClicksData(r.data));
  };

  const platformLabels: Record<string, string> = {
    web: "Web",
    android: "App",
    desktop: "Desktop",
  };
  const platformData = stats
    ? Object.entries(stats.platform_distribution)
        .filter(([, v]) => v > 0)
        .map(([key, value]) => ({
          key,
          name: platformLabels[key] ?? key,
          value,
        }))
    : [];

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Link to="/chats" className="text-slate-600 hover:text-slate-900 text-sm font-medium">
          ← Назад к чатам
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">Админ-панель</h1>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-6xl space-y-8">
        {statsError && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{statsError}</div>
        )}

        {stats && (
          <>
            <section>
              <h2 className="text-base font-semibold text-slate-800 mb-4">Метрики</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Авторизовалось сегодня</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stats.users_logged_in_today}</p>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Всего пользователей</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total_users}</p>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Оплачено подписок сегодня</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stats.paid_subscriptions_today}</p>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Новых пользователей сегодня</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stats.new_users_today}</p>
                </div>
              </div>
            </section>

            <section className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Распределение по платформам</h3>
                {platformData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={platformData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {platformData.map((entry, i) => (
                          <Cell key={i} fill={PLATFORM_COLORS[entry.key] || PLATFORM_COLORS.unknown} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-slate-500">Нет данных</p>
                )}
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Авторизации по дням (30 дней)</h3>
                {stats.auth_timeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.auth_timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-slate-500">Нет данных</p>
                )}
              </div>
            </section>
          </>
        )}

        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Обращения пользователей</h2>
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setFeedbackFilter("")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedbackFilter === "" ? "bg-slate-200" : "bg-slate-100 hover:bg-slate-200"}`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setFeedbackFilter("feedback")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedbackFilter === "feedback" ? "bg-blue-200" : "bg-slate-100 hover:bg-slate-200"}`}
            >
              Обратная связь
            </button>
            <button
              type="button"
              onClick={() => setFeedbackFilter("support")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedbackFilter === "support" ? "bg-amber-200" : "bg-slate-100 hover:bg-slate-200"}`}
            >
              Техподдержка
            </button>
          </div>
          {feedbackLoading ? (
            <p className="text-sm text-slate-500">Загрузка…</p>
          ) : feedbackList.length === 0 ? (
            <p className="text-sm text-slate-500">Нет обращений</p>
          ) : (
            <div className="space-y-3">
              {feedbackList.map((f) => (
                <div
                  key={f.id}
                  className={`rounded-lg border p-4 ${f.type === "support" ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${f.type === "support" ? "bg-amber-200 text-amber-800" : "bg-blue-100 text-blue-700"}`}>
                      {f.type === "support" ? "Техподдержка" : "Обратная связь"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {f.user_display_name || f.user_phone} · {new Date(f.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{f.message}</p>
                  {f.attachment_urls && f.attachment_urls.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {f.attachment_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-slate-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Меченые ссылки</h2>

          <form onSubmit={handleCreateLink} className="bg-white rounded-lg border border-slate-200 p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Метка</label>
                <input
                  type="text"
                  value={createTag}
                  onChange={(e) => setCreateTag(e.target.value)}
                  placeholder="Например: Реклама VK"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Slug (опционально)</label>
                <input
                  type="text"
                  value={createSlug}
                  onChange={(e) => setCreateSlug(e.target.value)}
                  placeholder="Авто, если пусто"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Целевой URL</label>
                <input
                  type="url"
                  value={createTargetUrl}
                  onChange={(e) => setCreateTargetUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <button
              type="submit"
              disabled={createSubmitting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createSubmitting ? "Создание…" : "Создать ссылку"}
            </button>
          </form>

          {linksLoading ? (
            <p className="text-sm text-slate-500">Загрузка…</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-slate-500">Нет меченых ссылок</p>
          ) : (
            <div className="space-y-2">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="bg-white rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{link.tag}</p>
                      <p className="text-sm text-slate-600 truncate">{link.target_url}</p>
                      <div className={`flex items-center gap-2 mt-2 flex-wrap ${linkCopyShakeId === link.id ? "animate-username-shake" : ""}`}>
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded truncate max-w-[280px]">
                          {link.full_url}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            copyToClipboard(link.full_url);
                            setLinkCopyShakeId(link.id);
                            setTimeout(() => setLinkCopyShakeId(null), 400);
                            setCopiedLinkId(link.id);
                            setTimeout(() => setCopiedLinkId(null), 2000);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
                        >
                          Копировать
                        </button>
                        {copiedLinkId === link.id && (
                          <span className="text-xs text-green-600 font-medium shrink-0">Скопировано</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm text-slate-500">{link.clicks_count} переходов</span>
                      <button
                        type="button"
                        onClick={() => handleShowClicks(link.id)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {expandedClicksId === link.id ? "Скрыть" : "Клики"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLink(link.id)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  {expandedClicksId === link.id && clicksData && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <p className="text-xs text-slate-500 mb-2">Всего: {clicksData.total}</p>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {clicksData.clicks.map((c) => (
                          <div
                            key={c.id}
                            className="text-xs text-slate-600 flex gap-2 py-1"
                          >
                            <span>{new Date(c.created_at).toLocaleString()}</span>
                            <span>{c.ip_masked ?? "—"}</span>
                            <span className="truncate max-w-[200px]" title={c.user_agent_short}>
                              {c.user_agent_short}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
