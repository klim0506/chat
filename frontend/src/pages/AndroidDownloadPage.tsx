import { Link } from "react-router-dom";
import { useDocumentHead } from "../hooks/useDocumentHead";
import { useTranslation } from "../lib/i18n";
import { ANDROID_APK_URL } from "../lib/host";

export default function AndroidDownloadPage() {
  const { t } = useTranslation();

  useDocumentHead(
    t("downloads.android.pageTitle"),
    t("downloads.android.pageDesc"),
  );

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center max-w-4xl">
          <Link to="/" aria-label="Pingy" className="inline-flex items-center text-blue-600">
            <img src="/assets/logo.png" alt="Pingy" className="h-[3.75rem] w-auto object-contain" />
          </Link>
          <nav className="flex gap-4">
            <Link to="/" className="text-slate-600 hover:text-slate-900 font-medium text-sm">
              {t("downloads.android.back")}
            </Link>
            <Link to="/auth" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700">
              {t("landing.login")}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="container mx-auto px-4 pt-14 pb-10 md:pt-20 md:pb-14 max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-6">
            {t("downloads.android.title")}
          </h1>
          <p className="text-slate-600 mb-8">
            {t("downloads.android.desc")}
          </p>

          <div className="space-y-4 mb-10">
            <a
              href={ANDROID_APK_URL}
              download="Pingy.apk"
              className="inline-flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t("downloads.android.download")}
            </a>
            <p className="text-slate-500 text-sm">
              {t("downloads.android.note")}
            </p>
          </div>

          <div className="border-t border-slate-200 pt-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              {t("downloads.android.alternatives")}
            </h2>
            <ul className="space-y-2 text-slate-600 text-sm">
              <li>
                <strong>{t("downloads.desktop.webLabel")}:</strong>{" "}
                <Link to="/auth" className="text-blue-600 hover:underline">
                  {t("downloads.desktop.webLink")}
                </Link>
              </li>
              <li>
                <strong>{t("downloads.desktop.title")}:</strong>{" "}
                <Link to="/downloads/desktop" className="text-blue-600 hover:underline">
                  {t("downloads.android.desktopLink")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mt-10">
            <Link to="/" className="text-blue-600 hover:underline text-sm">
              ← {t("downloads.android.back")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
