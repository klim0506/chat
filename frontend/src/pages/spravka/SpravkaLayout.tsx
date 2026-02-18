import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "../../lib/i18n";

export default function SpravkaLayout() {
  const location = useLocation();
  const { t } = useTranslation();

  const links = [
    { to: "/spravka", label: t("spravka.title") },
    { to: "/spravka/chats", label: t("spravka.chats") },
    { to: "/spravka/referral", label: t("spravka.referral") },
    { to: "/spravka/security", label: t("spravka.security") },
    { to: "/spravka/channels", label: t("spravka.channels") },
    { to: "/spravka/bots", label: t("spravka.bots") },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between max-w-4xl">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold text-blue-600 hover:text-blue-700">
            <img src="/logo.ico" alt="" className="h-7 w-7 object-contain" aria-hidden="true" />
            {t("landing.brand")}
          </Link>
          <Link to="/" className="text-slate-500 hover:text-slate-700 text-sm">
            {t("notFound.toHome")}
          </Link>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
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
