import { Link, Outlet, useLocation } from "react-router-dom";

const nav = [
  { to: "/spravka", label: "Справка" },
  { to: "/spravka/chats", label: "Чаты" },
  { to: "/spravka/referral", label: "Реферальная программа" },
  { to: "/spravka/security", label: "Безопасность" },
  { to: "/spravka/channels", label: "Каналы" },
  { to: "/spravka/bots", label: "Боты" },
] as const;

export default function SpravkaLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3 max-w-4xl">
          <Link to="/" className="text-lg font-semibold text-blue-600 hover:text-blue-700">
            Приватные чаты
          </Link>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link to="/" className="text-slate-500 hover:text-slate-700">
              Главная
            </Link>
            {nav.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-2 py-1 rounded ${
                  location.pathname === to ? "bg-blue-100 text-blue-700 font-medium" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 mt-12">
        <div className="container mx-auto px-4 max-w-4xl text-center text-slate-500 text-sm">
          <Link to="/" className="hover:text-slate-700">На главную</Link>
          {" · "}
          <Link to="/auth" className="hover:text-slate-700">Войти</Link>
        </div>
      </footer>
    </div>
  );
}
