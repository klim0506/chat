import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../lib/i18n";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore, type AppLanguage } from "../store/preferences";
import { api } from "../api/client";

const PREFERENCES_STORAGE_KEY = "preferences";
const GEO_TIMEOUT_MS = 3500;

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (private mode, quotas, etc.)
  }
}

function getCountryCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { country_code?: unknown; countryCode?: unknown; success?: unknown };
  if (data.success === false) return null;
  const raw = typeof data.country_code === "string"
    ? data.country_code
    : typeof data.countryCode === "string"
      ? data.countryCode
      : null;
  return raw ? raw.toUpperCase() : null;
}

export default function LandingPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const [suggestedLanguage, setSuggestedLanguage] = useState<AppLanguage | null>(null);

  useEffect(() => {
    let cancelled = false;

    const detectLanguageByIp = async () => {
      const hasStoredPreferences = safeGetItem(PREFERENCES_STORAGE_KEY) !== null;
      const currentLanguage = usePreferencesStore.getState().language;

      let countryCode: string | null = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
        const { data } = await api.get<{ country_code?: string | null }>("/geo/country-code/", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        countryCode = getCountryCode(data);
      } catch {
        // Backend geo or network failure; keep current language
      }
      if (!countryCode || cancelled) return;

      const recommendedLanguage: AppLanguage = countryCode === "RU" ? "ru" : "en";

      if (!hasStoredPreferences) {
        if (currentLanguage !== recommendedLanguage) setLanguage(recommendedLanguage);
        return;
      }

      const dismissKey = `landing-lang-suggest-dismissed-${recommendedLanguage}`;
      const isDismissed = safeGetItem(dismissKey) === "1";
      if (!isDismissed && currentLanguage !== recommendedLanguage) {
        setSuggestedLanguage(recommendedLanguage);
      }
    };

    void detectLanguageByIp();

    return () => {
      cancelled = true;
    };
  }, [setLanguage]);

  const applySuggestedLanguage = () => {
    if (!suggestedLanguage) return;
    setLanguage(suggestedLanguage);
    safeSetItem(`landing-lang-suggest-dismissed-${suggestedLanguage}`, "1");
    setSuggestedLanguage(null);
  };

  const dismissLanguageSuggestion = () => {
    if (!suggestedLanguage) return;
    safeSetItem(`landing-lang-suggest-dismissed-${suggestedLanguage}`, "1");
    setSuggestedLanguage(null);
  };

  const suggestionCopy = suggestedLanguage === "ru"
    ? {
        title: "Похоже, вы из России. Переключить сайт на русский?",
        apply: "Переключить на русский",
        dismiss: "Оставить English",
      }
    : {
        title: "Looks like you're outside Russia. Switch site to English?",
        apply: "Switch to English",
        dismiss: "Keep Russian",
      };

  const features = [
    {
      title: t("landing.feature1.title"),
      description: t("landing.feature1.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: t("landing.feature2.title"),
      description: t("landing.feature2.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
    },
    {
      title: t("landing.feature3.title"),
      description: t("landing.feature3.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: t("landing.feature4.title"),
      description: t("landing.feature4.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
  ];

  const scope = [
    { count: "2", label: t("landing.scope.personal") },
    { count: "10", label: t("landing.scope.group") },
    { count: "100", label: t("landing.scope.team") },
    { count: "1000", label: t("landing.scope.community") },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased">
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center max-w-4xl">
          <Link to="/" aria-label={t("landing.brand")} className="inline-flex items-center text-blue-600">
            <img src="/logo2_not_height_png_ai_transparent.png" alt={t("landing.brand")} className="h-[3.75rem] w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/wiki" className="text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors">
              {t("landing.help")}
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

      {suggestedLanguage && (
        <section className="border-b border-blue-100 bg-blue-50">
          <div className="container mx-auto px-4 py-3 max-w-4xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-blue-900">{suggestionCopy.title}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applySuggestedLanguage}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                {suggestionCopy.apply}
              </button>
              <button
                type="button"
                onClick={dismissLanguageSuggestion}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                {suggestionCopy.dismiss}
              </button>
            </div>
          </div>
        </section>
      )}

      <main>
        <section className="container mx-auto px-4 pt-16 pb-20 md:pt-24 md:pb-28 max-w-4xl">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-blue-600 font-medium text-sm mb-3">
              {t("landing.hero.tag")}
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-5">
              {t("landing.hero.title1")}
              <span className="text-blue-600">{t("landing.hero.titleHighlight")}</span>
              {t("landing.hero.title2")}
            </h1>
            <p className="text-slate-600 text-base md:text-lg mb-8">
              {t("landing.hero.desc")}
            </p>
            <p className="text-slate-500 text-sm mb-10">
              {t("landing.hero.subdesc")}
            </p>
            <div>
              {!isAuthenticated ? (
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  {t("landing.hero.start")}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : (
                <Link
                  to="/chats"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  {t("landing.hero.createChat")}
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
              {t("landing.features.title")}
            </h2>
            <p className="text-slate-600 text-center text-sm mb-12 max-w-xl mx-auto">
              {t("landing.features.subtitle")}
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
            {t("landing.scope.title")}
          </h2>
          <p className="text-slate-600 text-center text-sm mb-8 max-w-lg mx-auto">
            {t("landing.scope.desc")}
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
              {t("landing.cta.title")}
            </h2>
            <p className="text-slate-600 text-sm mb-8 max-w-md mx-auto">
              {t("landing.cta.desc")}
            </p>
            {!isAuthenticated ? (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                {t("landing.cta.loginOrRegister")}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            ) : (
              <Link
                to="/chats"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                {t("landing.cta.createNew")}
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
          <span className="text-slate-500 text-sm">{t("landing.footer.copy")}</span>
          <nav className="flex items-center gap-6 text-sm">
            <Link to="/wiki" className="text-slate-500 hover:text-slate-700 transition-colors">
              {t("landing.help")}
            </Link>
            <Link to="/auth" className="text-slate-500 hover:text-slate-700 transition-colors">
              {t("landing.login")}
            </Link>
            {isAuthenticated && (
              <Link to="/chats" className="text-slate-500 hover:text-slate-700 transition-colors">
                {t("landing.dashboard")}
              </Link>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
