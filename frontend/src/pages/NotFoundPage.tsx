import { Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useTranslation } from "../lib/i18n";

export default function NotFoundPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-slate-200 select-none mb-2">404</div>
        <h1 className="text-2xl font-semibold text-slate-800 mb-2">Страница не найдена</h1>
        <p className="text-slate-500 mb-8">
          Такой страницы не существует или она была удалена.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to={isAuthenticated ? "/chats" : "/"}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            {isAuthenticated ? t("notFound.toChats") : t("notFound.toHome")}
          </Link>
          <button
            onClick={() => window.history.back()}
            className="border border-slate-300 text-slate-700 px-5 py-2.5 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium"
          >
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}
