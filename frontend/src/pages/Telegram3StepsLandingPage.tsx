import { Link } from "react-router-dom";
import { useDocumentHead } from "../hooks/useDocumentHead";
import { useAuthStore } from "../store/auth";

export default function Telegram3StepsLandingPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useDocumentHead(
    "Как не потерять данные из личного чата в Telegram — в 3 шага | Pingy",
    "Пошаговый план: зарегистрируйтесь вдвоём на pingychat.com, выгрузите историю Telegram в JSON (за последние 6 месяцев, без стикеров) и импортируйте её в личный чат, сопоставив участников."
  );

  const steps = [
    {
      title: "1) Зарегистрируйтесь вдвоём в Pingy",
      desc: "Оба участника личного чата создают аккаунт на pingychat.com — так вы сможете восстановить диалог у себя в профиле.",
      cta: !isAuthenticated
        ? { to: "/auth", label: "Зарегистрироваться" }
        : { to: "/chats", label: "Открыть чаты" },
    },
    {
      title: "2) Выгрузите историю Telegram в JSON",
      desc: "Сделайте экспорт истории выбранного диалога в формате JSON (например, через Telegram Desktop). Выгружайте только последние 6 месяцев; стикеры можно не включать. Сохраните файл на устройстве.",
    },
    {
      title: "3) Импортируйте JSON в личный чат в Pingy",
      desc: "Откройте импорт в Pingy, загрузите JSON и выберите, кто из пользователей «кто есть кто», чтобы корректно распределились сообщения.",
    },
  ] as const;

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center max-w-4xl">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold text-blue-600">
            <img src="/logo.ico" alt="" className="h-7 w-7 object-contain" aria-hidden="true" />
            Pingy
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/spravka" className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors">
              Справка
            </Link>
            {!isAuthenticated ? (
              <Link
                to="/auth"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
              >
                Войти / Регистрация
              </Link>
            ) : (
              <Link
                to="/chats"
                className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors"
              >
                Чаты
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="container mx-auto px-4 pt-14 pb-10 md:pt-20 md:pb-14 max-w-4xl">
          <div className="max-w-2xl">
            <p className="text-blue-600 font-medium text-sm mb-3">
              Гайд для личных чатов
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-5">
              Как не потерять данные из личного чата в Telegram — в 3 шага
            </h1>
            <p className="text-slate-600 text-base md:text-lg mb-8">
              Перенесите историю переписки в Pingy, чтобы она оставалась у вас под рукой: в одном месте, в вашем аккаунте.
            </p>

            <div className="flex flex-wrap gap-3">
              {!isAuthenticated ? (
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Начать с регистрации
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : (
                <Link
                  to="/chats"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Перейти в чаты
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              )}
              <Link
                to="/"
                className="inline-flex items-center gap-2 border border-slate-200 bg-white text-slate-800 px-6 py-3 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                На главную
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-blue-50/50 border-y border-slate-100 py-12 md:py-14">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              3 шага, чтобы сохранить историю
            </h2>
            <p className="text-slate-600 text-sm mb-8 max-w-2xl">
              Просто следуйте плану: аккаунты для обоих участников, экспорт из Telegram в JSON и импорт в Pingy с сопоставлением участников.
            </p>

            <div className="grid gap-6">
              {steps.map((s) => (
                <div key={s.title} className="bg-white rounded-xl border border-slate-200 p-6">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
                    {s.title}
                  </h3>
                  <p className="text-slate-600 text-sm leading-relaxed mb-4">
                    {s.desc}
                  </p>
                  {"cta" in s && s.cta ? (
                    <Link
                      to={s.cta.to}
                      className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-800 font-medium text-sm transition-colors"
                    >
                      {s.cta.label}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-12 md:py-14 max-w-4xl">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Важно
            </h2>
            <ul className="text-slate-600 text-sm list-disc pl-5 space-y-2">
              <li>Экспортируйте только тот диалог, который действительно хотите сохранить.</li>
              <li>Ограничьте экспорт последними 6 месяцами.</li>
              <li>Стикеры можно не выгружать.</li>
              <li>Если в JSON есть вложения, убедитесь, что они тоже корректно выгрузились.</li>
              <li>При импорте внимательно сопоставьте участников, чтобы сообщения не «перепутались».</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <div className="container mx-auto px-4 max-w-4xl flex flex-col sm:flex-row justify-between items-center gap-3">
          <span className="text-slate-500 text-sm">© {new Date().getFullYear()} Pingy</span>
          <nav className="flex items-center gap-6 text-sm">
            <Link to="/spravka" className="text-slate-500 hover:text-slate-700 transition-colors">
              Справка
            </Link>
            <Link to="/auth" className="text-slate-500 hover:text-slate-700 transition-colors">
              Войти
            </Link>
            <Link to="/" className="text-slate-500 hover:text-slate-700 transition-colors">
              Главная
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
