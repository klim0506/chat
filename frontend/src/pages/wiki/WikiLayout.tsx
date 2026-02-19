import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "../../lib/i18n";
import { useAuthStore } from "../../store/auth";

export default function WikiLayout() {
  const location = useLocation();
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const links = [
    { to: "/wiki", label: t("wiki.title") },
    { to: "/wiki/chats", label: t("wiki.chats") },
    { to: "/wiki/referral", label: t("wiki.referral") },
    { to: "/wiki/security", label: t("wiki.security") },
    { to: "/wiki/channels", label: t("wiki.channels") },
    { to: "/wiki/bots", label: t("wiki.bots") },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between max-w-4xl">
          <Link to="/" aria-label={t("landing.brand")} className="inline-flex items-center text-blue-600 hover:text-blue-700">
            <img src="/assets/logo.png" alt={t("landing.brand")} className="h-[3.75rem] w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/" className="text-slate-500 hover:text-slate-700 text-sm">
              {t("notFound.toHome")}
            </Link>
            {isAuthenticated ? (
              <Link
                to="/chats"
                className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors"
              >
                {t("landing.dashboard")}
              </Link>
            ) : (
              <Link
                to="/auth"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
              >
                {t("landing.login")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="rounded-lg bg-slate-100 border border-slate-200 p-4 mb-6 text-slate-700">
          <p className="font-semibold text-slate-900 mb-1">Что такое Pingy</p>
          <p className="text-sm">Pingy — быстрый и безопасный мессенджер для мобильных устройств и компьютеров. Миссия Pingy — дать людям возможность свободно общаться: ваши переписки защищены, доступ в чаты только по приглашению, вы сами решаете, с кем делиться ссылками. Без рекламы в чатах и без слежки пользователями: все сообщения шифруются программно по технологиям телеграмм и никто не имеет доступа к перепискам.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2 text-sm mb-6">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                location.pathname === to
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 mt-12">
        <div className="container mx-auto px-4 max-w-4xl text-center text-slate-500 text-sm">
          <Link to="/" className="hover:text-slate-700">{t("notFound.toHome")}</Link>
          {" · "}
          <Link to="/auth" className="hover:text-slate-700">{t("landing.login")}</Link>
        </div>
      </footer>
    </div>
  );
}
