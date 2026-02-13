import { Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";

const features = [
  {
    title: "Без VPN",
    description: "Работает из России без обходов и прокси. Никаких блокировок — ваш чат доступен всегда.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    title: "Быстрая загрузка файлов",
    description: "Любые файлы загружаются быстро — видео, документы, медиа. Сейчас до 0,5 ГБ на файл; в планах интеграция с облаком для хранения ваших данных.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    ),
  },
  {
    title: "В реальном времени",
    description: "Сообщения и медиа доставляются мгновенно. Никаких задержек.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: "Ваш чат, не чужой",
    description: "Не зависите от блокировок и навязанных мессенджеров. Вход по SMS. Все чаты бесплатны — от двоих до сотен участников.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
];

const scope = [
  { count: "2", label: "Личный чат" },
  { count: "10", label: "Группа" },
  { count: "100", label: "Команда" },
  { count: "1000", label: "Сообщество" },
];

export default function LandingPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center max-w-4xl">
          <Link to="/" className="text-lg font-semibold text-blue-600">
            Приватные чаты
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/spravka" className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors">
              Справка
            </Link>
            {isAuthenticated ? (
              <>
                <Link
                  to="/dashboard"
                  className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors"
                >
                  Личный кабинет
                </Link>
                <Link
                  to="/settings"
                  className="p-2 text-slate-500 hover:text-slate-700 rounded-lg transition-colors"
                  title="Настройки"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </Link>
              </>
            ) : (
              <Link
                to="/auth"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
              >
                Войти
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="container mx-auto px-4 pt-16 pb-20 md:pt-24 md:pb-28 max-w-4xl">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-blue-600 font-medium text-sm mb-3">
              Свой мессенджер без блокировок и VPN
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-5">
              Чаты, которые{" "}
              <span className="text-blue-600">работают всегда</span>. Без VPN. Все чаты бесплатны.
            </h1>
            <p className="text-slate-600 text-base md:text-lg mb-8">
              Когда привычные мессенджеры блокируют, а альтернативы навязывают — свой мессенджер под вашим контролем. Доступ по подписке: регистрация по SMS, любые файлы загружаются быстро.
            </p>
            <p className="text-slate-500 text-sm mb-10">
              Мессенджер доступен по подписке — все чаты бесплатны, от двоих до сотен участников.
            </p>
            <div>
              {!isAuthenticated ? (
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Начать бесплатно
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : (
                <Link
                  to="/dashboard/create"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Создать чат
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="bg-blue-50/50 border-y border-slate-100 py-16 md:py-20">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-xl font-bold text-slate-900 text-center mb-2">
              Почему свой чат, а не чужой мессенджер
            </h2>
            <p className="text-slate-600 text-center text-sm mb-12 max-w-xl mx-auto">
              Без VPN, без блокировок, без навязанных приложений.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="bg-white rounded-lg border border-slate-200 p-5"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-1">{f.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 md:py-20 max-w-4xl">
          <h2 className="text-xl font-bold text-slate-900 text-center mb-2">
            Одна подписка — все чаты
          </h2>
          <p className="text-slate-600 text-center text-sm mb-8 max-w-lg mx-auto">
            Мессенджер доступен по подписке. Все чаты бесплатны: от личного на двоих до чата на сотни участников.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {scope.map((p) => (
              <div
                key={p.count}
                className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-6 py-4 min-w-[100px] text-slate-700"
              >
                <span className="text-2xl font-bold">{p.count}</span>
                <span className="text-sm">{p.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-blue-50/50 border-t border-slate-100 py-16 md:py-20">
          <div className="container mx-auto px-4 max-w-4xl text-center">
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              Готовы начать?
            </h2>
            <p className="text-slate-600 text-sm mb-8 max-w-md mx-auto">
              Регистрация по SMS за минуту. Работает без VPN. Доступ по подписке — все чаты бесплатны, файлы загружаются быстро.
            </p>
            {!isAuthenticated ? (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Войти или зарегистрироваться
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            ) : (
              <Link
                to="/dashboard/create"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Создать новый чат
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </Link>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <div className="container mx-auto px-4 max-w-4xl flex flex-col sm:flex-row justify-between items-center gap-3">
          <span className="text-slate-500 text-sm">© Приватные чаты</span>
          <nav className="flex items-center gap-6 text-sm">
            <Link to="/spravka" className="text-slate-500 hover:text-slate-700 transition-colors">
              Справка
            </Link>
            <Link to="/auth" className="text-slate-500 hover:text-slate-700 transition-colors">
              Войти
            </Link>
            {isAuthenticated && (
              <Link to="/dashboard" className="text-slate-500 hover:text-slate-700 transition-colors">
                Личный кабинет
              </Link>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
