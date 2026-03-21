import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../lib/i18n";
import type { AppLanguage } from "../store/preferences";
import { useAuthStore } from "../store/auth";
import { api } from "../api/client";
import { APP_BASE_URL, ANDROID_APK_FILENAME, ANDROID_APK_URL } from "../lib/host";

const GEO_TIMEOUT_MS = 3500;

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [landingLang, setLandingLang] = useState<AppLanguage>("ru");
  const [geoReady, setGeoReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (!cancelled) setGeoReady(true);
    }, GEO_TIMEOUT_MS);

    const detectLanguageByGeo = async () => {
      let countryCode: string | null = null;
      try {
        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
        const { data } = await api.get<{ country_code?: string | null }>("/geo/country-code/", {
          signal: controller.signal,
        });
        clearTimeout(requestTimeout);
        countryCode = getCountryCode(data);
      } catch {
        // Backend geo or network failure; keep default (ru)
      }

      if (cancelled) return;
      if (countryCode && countryCode !== "RU") {
        setLandingLang("en");
      }
      setGeoReady(true);
    };

    void detectLanguageByGeo();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  const tr = (key: Parameters<typeof t>[0]) => t(key, landingLang);

  const features = [
    {
      title: tr("landing.feature1.title"),
      description: tr("landing.feature1.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: tr("landing.feature2.title"),
      description: tr("landing.feature2.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
    },
    {
      title: tr("landing.feature3.title"),
      description: tr("landing.feature3.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: tr("landing.feature4.title"),
      description: tr("landing.feature4.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    {
      title: tr("landing.feature5.title"),
      description: tr("landing.feature5.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: tr("landing.feature6.title"),
      description: tr("landing.feature6.desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      ),
    },
  ];

  if (!geoReady) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center max-w-6xl">
          <Link to="/" aria-label={tr("landing.brand")} className="inline-flex items-center text-blue-600">
            <img src="/assets/logo.png" alt={tr("landing.brand")} className="h-16 md:h-[4.5rem] w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-5">
            <Link to="/wiki" className="text-slate-600 hover:text-slate-900 font-medium text-base transition-colors">
              {tr("landing.help")}
            </Link>
            {isAuthenticated ? (
              <a
                href={`${APP_BASE_URL}/chats`}
                className="text-slate-600 hover:text-slate-900 font-medium text-base transition-colors"
              >
                {tr("landing.dashboard")}
              </a>
            ) : (
              <a
                href={`${APP_BASE_URL}/auth`}
                className="bg-blue-600 text-white px-5 py-3 rounded-lg font-medium text-base hover:bg-blue-700 transition-colors"
              >
                {tr("landing.login")}
              </a>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="container mx-auto px-4 pt-16 pb-8 md:pt-24 md:pb-12 max-w-6xl">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 leading-snug mb-20 flex flex-col items-center justify-center gap-3">
              <img src="/assets/logo.png" alt={tr("landing.brand")} className="h-[4.5rem] sm:h-[5.25rem] md:h-[6rem] w-auto" />
              <span>
                {tr("landing.hero.titleHighlight")}
                {tr("landing.hero.title2")}
              </span>
            </h1>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed mb-20">
              {tr("landing.hero.desc")}
            </p>
            <div className="flex flex-wrap gap-3 justify-center mb-4">
              {!isAuthenticated ? (
                <a
                  href={`${APP_BASE_URL}/auth`}
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
                >
                  {tr("landing.hero.start")}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </a>
              ) : (
                <a
                  href={`${APP_BASE_URL}/chats`}
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
                >
                  {tr("landing.hero.createChat")}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </a>
              )}
            </div>
            <p className="text-sm text-slate-500">
              <a href={`${APP_BASE_URL}/downloads/desktop/Pingy-setup.exe`} download className="text-slate-600 hover:underline">Windows</a>
              {", "}
              <a href={ANDROID_APK_URL} download={ANDROID_APK_FILENAME} className="text-slate-600 hover:underline">Android</a>
              {", "}
              <a href={`${APP_BASE_URL}/auth`} className="text-slate-600 hover:underline">Web</a>
            </p>
          </div>
        </section>

        <section className="bg-blue-50/50 border-y border-slate-100 py-12 md:py-16">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 text-center mb-3">
              {tr("landing.features.title")}
            </h2>
            <p className="text-slate-600 text-center text-base md:text-lg mb-8 max-w-3xl mx-auto">
              {tr("landing.features.subtitle")}
            </p>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="bg-white rounded-xl border border-slate-200 p-5 md:p-6 shadow-sm transition-all duration-200 hover:border-blue-300 hover:shadow-md hover:scale-[1.02]"
                >
                  <div className="w-11 h-11 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-2">{f.title}</h3>
                  <p className="text-slate-600 text-base leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
            <p className="text-slate-500 text-sm text-center mt-8">
              <Link to="/wiki" className="text-blue-600 hover:text-blue-700 hover:underline">
                {tr("landing.features.wikiHint")}
              </Link>
            </p>
          </div>
        </section>

        <section className="border-t border-slate-100 bg-slate-50/30 py-8 md:py-10">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 text-center mb-3">
              {tr("landing.downloads.blockTitle")}
            </h2>
            <p className="text-slate-600 text-center text-sm mb-6 max-w-2xl mx-auto">
              {tr("landing.downloads.blockSubtitle")}
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {/* Web — ссылка на web.pingychat.com при VITE_WEB_APP_URL */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  {tr("landing.downloads.clusterWeb")}
                </h3>
                <a
                href={`${APP_BASE_URL}/auth`}
                className="flex items-center gap-3 p-3 rounded-lg border-2 border-blue-200 bg-blue-50 hover:border-blue-400 hover:bg-blue-100/50 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </div>
                <div>
                  <span className="font-medium text-slate-900 block">{tr("landing.downloads.web")}</span>
                  <span className="text-xs text-slate-500">{tr("landing.downloads.webDesc")}</span>
                </div>
              </a>
              </div>

              {/* Desktop */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  {tr("landing.downloads.clusterDesktop")}
                </h3>
                <div className="space-y-2">
                  <a
                    href={`${APP_BASE_URL}/downloads/desktop/Pingy-setup.exe`}
                    download
                    className="flex items-center gap-3 p-3 rounded-lg border-2 border-[#0078D4]/30 bg-[#0078D4]/5 hover:border-[#0078D4]/50 hover:bg-[#0078D4]/10 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M0 3.449V9.75h5.801V3.449H0zm7.199 0v6.301h9V3.449h-9zM0 10.8v9.751h5.801V10.8H0zm7.199 0v9.751h9V10.8h-9z" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-medium text-slate-900 block">{tr("landing.downloads.windows")}</span>
                      <span className="text-xs text-slate-500">{tr("landing.downloads.windowsDesc")}</span>
                    </div>
                  </a>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-slate-500">
                    <div className="w-10 h-10 rounded-lg bg-slate-200 text-slate-400 flex items-center justify-center">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 block">{tr("landing.downloads.macos")}</span>
                      <span className="text-xs text-amber-600">{tr("landing.downloads.comingSoon")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-slate-500">
                    <div className="w-10 h-10 rounded-lg bg-slate-200 text-slate-400 flex items-center justify-center">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.5.56-.623.96-.199.682.039 1.394.323 1.96.345.682.925 1.273 1.646 1.584.542.234 1.111.334 1.684.295 1.573-.159 2.924-1.073 3.562-2.545.795.091 1.65-.042 2.376-.484 1.741-1.037 2.406-3.264 2.508-5.228.065-1.104.06-2.239-.052-3.349-.102-1.199-.312-2.375-.498-3.539-.193-1.18-.563-2.446-.178-3.577.383-1.111 1.606-1.713 2.578-2.271.623-.359 1.251-.782 1.547-1.456.295-.673.215-1.485-.197-2.111-.359-.56-.947-.93-1.563-1.132-.591-.189-1.237-.194-1.802.033-.565.226-1.058.687-1.334 1.242-.276.555-.382 1.194-.252 1.773.038.163.097.317.168.461-.192-.043-.389-.066-.588-.069-1.701-.067-3.328.721-4.597 1.926-.159.151-.308.31-.447.476-.418-.769-1.185-1.389-2.07-1.656-.885-.267-1.843-.15-2.656.328C1.877 2.496 1.172 3.792 1.091 5.2c-.081 1.409.486 2.757 1.453 3.61.337.295.717.548 1.127.748-.181.257-.341.53-.477.817-.574 1.199-.49 2.561.196 3.682.686 1.121 1.846 1.805 3.107 1.902.066.005.133.009.199.009h.009c.065 0 .13-.004.194-.009 1.347-.098 2.545-.87 3.197-2.034.652-1.164.676-2.553.062-3.751z" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 block">{tr("landing.downloads.linux")}</span>
                      <span className="text-xs text-amber-600">{tr("landing.downloads.comingSoon")}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  {tr("landing.downloads.clusterMobile")}
                </h3>
                <div className="space-y-2">
                  <a
                    href={ANDROID_APK_URL}
                    download={ANDROID_APK_FILENAME}
                    className="flex items-center gap-3 p-3 rounded-lg border-2 border-green-200 bg-green-50 hover:border-green-400 hover:bg-green-100/50 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.523 15.341c-.551 0-.999-.448-.999-.999s.448-.999.999-.999.999.448.999.999-.448.999-.999.999zm-11.046 0c-.551 0-.999-.448-.999-.999s.448-.999.999-.999.999.448.999.999-.448.999-.999.999zm11.404-6.02l1.997-3.459a.416.416 0 00-.152-.567.416.416 0 00-.568.152l-2.022 3.501C15.59 8.243 13.853 7.658 12 7.658s-3.59.585-5.136 1.69L4.842 5.848a.416.416 0 00-.568-.152.416.416 0 00-.152.567l1.997 3.459C2.688 11.186.343 14.658 0 18.761h24c-.343-4.103-2.688-7.575-6.119-9.44z" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-medium text-slate-900 block">{tr("landing.downloads.androidLabel")}</span>
                      <span className="text-xs text-slate-500">{tr("landing.downloads.androidDesc")}</span>
                    </div>
                  </a>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-slate-500">
                    <div className="w-10 h-10 rounded-lg bg-slate-200 text-slate-400 flex items-center justify-center">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 block">{tr("landing.downloads.ios")}</span>
                      <span className="text-xs text-amber-600">{tr("landing.downloads.comingSoon")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-blue-50/50 border-t border-slate-100 py-12 md:py-14">
          <div className="container mx-auto px-4 max-w-6xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-6">
              {tr("landing.cta.title")}
            </h2>
            <p className="text-slate-600 text-base md:text-lg mb-8 max-w-2xl mx-auto">
              {tr("landing.cta.desc")}
            </p>
            {!isAuthenticated ? (
              <a
                href={`${APP_BASE_URL}/auth`}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
              >
                {tr("landing.cta.button")}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            ) : (
              <a
                href={`${APP_BASE_URL}/chats`}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
              >
                {tr("landing.cta.buttonAuth")}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <div className="container mx-auto px-4 max-w-6xl flex flex-col sm:flex-row justify-between items-center gap-3">
          <span className="text-slate-500 text-sm">{tr("landing.footer.copy")}</span>
          <nav className="flex items-center gap-6 text-sm">
            <a href={`${APP_BASE_URL}/downloads/desktop`} className="text-slate-500 hover:text-slate-700 transition-colors">
              {tr("landing.downloads.desktop")}
            </a>
            <a href={`${APP_BASE_URL}/downloads/android`} className="text-slate-500 hover:text-slate-700 transition-colors">
              {tr("landing.downloads.android")}
            </a>
            <Link to="/wiki" className="text-slate-500 hover:text-slate-700 transition-colors">
              {tr("landing.help")}
            </Link>
            <a href={`${APP_BASE_URL}/auth`} className="text-slate-500 hover:text-slate-700 transition-colors">
              {tr("landing.login")}
            </a>
            {isAuthenticated && (
              <a href={`${APP_BASE_URL}/chats`} className="text-slate-500 hover:text-slate-700 transition-colors">
                {tr("landing.dashboard")}
              </a>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
