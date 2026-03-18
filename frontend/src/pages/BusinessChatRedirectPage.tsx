import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useDocumentHead } from "../hooks/useDocumentHead";

export default function BusinessChatRedirectPage() {
  useDocumentHead(
    "Pingy для бизнеса",
    "Чаты для рабочих задач: большие файлы, шифрование и единая оплата аккаунтов команды."
  );

  useEffect(() => {
    window.location.assign("/landing/index.html");
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Переходим на страницу Pingy для бизнеса…</h1>
        <p className="text-sm text-slate-600 mb-4">Если переход не случился автоматически, откройте страницу вручную.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <a
            className="inline-flex items-center justify-center bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
            href="/landing/index.html"
          >
            Открыть лендинг
          </a>
          <Link
            to="/"
            className="inline-flex items-center justify-center border border-slate-200 bg-white text-slate-800 px-4 py-2 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}

