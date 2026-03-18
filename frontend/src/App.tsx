import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { api, authApi, chatsApi, type User } from "./api/client";
import { useUnreadBadge } from "./hooks/useUnreadBadge";
import { isStandalone } from "./lib/pwa";
import { isMarketingSite, APP_BASE_URL } from "./lib/host";
import { AlphaBannerModal } from "./components/AlphaBannerModal";
import PremiumRequiredModal from "./components/PremiumRequiredModal";
import PremiumPromptPopup from "./components/PremiumPromptPopup";

function FullscreenSpinner() {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-slate-50">
      <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Redirect to the app domain (web.pingychat.com) preserving path and search. Used on marketing site. */
function RedirectToApp() {
  const location = useLocation();
  useEffect(() => {
    const target = `${APP_BASE_URL}${location.pathname}${location.search}`;
    window.location.href = target;
  }, [location.pathname, location.search]);
  return <FullscreenSpinner />;
}

/** Redirect to the marketing site wiki (pingychat.com/wiki). Used on app domain. */
function RedirectToWiki() {
  const location = useLocation();
  useEffect(() => {
    const target = `https://pingychat.com${location.pathname}${location.search}`;
    window.location.href = target;
  }, [location.pathname, location.search]);
  return <FullscreenSpinner />;
}

/** На Android пока показываем веб-версию (без редиректа на страницу APK). */
function AndroidWebBlocker({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Guard: only render children when user is fully registered; otherwise redirect to /auth. Defined at module scope so React does not unmount children when App re-renders. */
function RequireFullyRegistered({
  children,
  isFullyRegistered,
}: {
  children: React.ReactNode;
  isFullyRegistered: boolean;
}) {
  const location = useLocation();
  if (isFullyRegistered) return <>{children}</>;
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/auth?next=${next}`} replace />;
}

/** Auth page route: if already fully registered, redirect to target; otherwise show AuthPage. Defined at module scope for stable identity. */
function AuthRoute({ isFullyRegistered }: { isFullyRegistered: boolean }) {
  const location = useLocation();
  const search = location.search || "";
  const nextUrl = new URLSearchParams(search).get("next");
  const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
  if (isFullyRegistered) {
    return <Navigate to={target} replace />;
  }
  return <AuthPage />;
}

// Lazy-loaded pages — each page is loaded as a separate chunk
const AuthPage = lazy(() => import("./pages/AuthPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const MessengerPage = lazy(() => import("./pages/MessengerPage"));
const JoinChatPage = lazy(() => import("./pages/JoinChatPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const WikiLayout = lazy(() => import("./pages/wiki/WikiLayout"));
const WikiIndexPage = lazy(() => import("./pages/wiki/WikiIndexPage"));
const WikiChatsPage = lazy(() => import("./pages/wiki/WikiChatsPage"));
const WikiReferralPage = lazy(() => import("./pages/wiki/WikiReferralPage"));
const WikiSecurityPage = lazy(() => import("./pages/wiki/WikiSecurityPage"));
const WikiChannelsPage = lazy(() => import("./pages/wiki/WikiChannelsPage"));
const WikiBotsPage = lazy(() => import("./pages/wiki/WikiBotsPage"));
const DesktopDownloadPage = lazy(() => import("./pages/DesktopDownloadPage"));
const AndroidDownloadPage = lazy(() => import("./pages/AndroidDownloadPage"));
const Telegram3StepsLandingPage = lazy(() => import("./pages/Telegram3StepsLandingPage"));
const Lending2Page = lazy(() => import("./pages/Lending2Page"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));

function JoinChatRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const username = useAuthStore((s) => s.user?.username);
  const location = useLocation();
  const { slug: slugParam } = useParams<{ slug: string }>();
  const searchParams = new URLSearchParams(location.search);
  const slug = slugParam || searchParams.get("slug") || "";
  const code = searchParams.get("code") || "";

  if (!isAuthenticated || !username) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }
  if (slug && code) {
    const params = new URLSearchParams({ join_slug: slug, join_code: code });
    return <Navigate to={`/chats?${params.toString()}`} replace />;
  }
  return <JoinChatPage />;
}

/** User is fully registered only when they have both tokens and a username. */
function useFullyRegistered() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const username = useAuthStore((s) => s.user?.username);
  return isAuthenticated && !!username;
}

/** /u/:username deep link — resolve username, open DM, redirect to chat. */
function UsernameDeepLinkRoute() {
  const { username: usernameParam } = useParams<{ username: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isFullyRegistered = useFullyRegistered();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usernameParam?.trim() || !isAuthenticated) return;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await authApi.resolveUsername(usernameParam);
        const { data: chat } = await chatsApi.getOrCreateDm(data.id);
        window.location.href = `/chat/${chat.id}`;
      } catch {
        setError("User not found");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [usernameParam, isAuthenticated]);

  if (!isAuthenticated || !isFullyRegistered) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }
  if (!usernameParam?.trim()) return <Navigate to="/chats" replace />;
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) return <Navigate to="/chats" replace />;
  return (
    <div className="flex items-center justify-center h-screen w-screen">
      <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const clientType = (import.meta.env.VITE_CLIENT_TYPE as string) || "web";
const isWeb = clientType === "web";

/** Wait for auth store to rehydrate from localStorage so we don't flash /auth then switch to /chats. */
function useAuthRehydrated() {
  const [rehydrated, setRehydrated] = useState(() => {
    return typeof useAuthStore.persist?.hasHydrated === "function" ? useAuthStore.persist.hasHydrated() : true;
  });
  useEffect(() => {
    if (rehydrated) return;
    const persistApi = useAuthStore.persist;
    if (!persistApi?.onFinishHydration) {
      setRehydrated(true);
      return;
    }
    const unsub = persistApi.onFinishHydration(() => setRehydrated(true));
    return unsub;
  }, [rehydrated]);
  return rehydrated;
}

function App() {
  const authRehydrated = useAuthRehydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setTokens = useAuthStore((s) => s.setTokens);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const user = useAuthStore((s) => s.user);
  const isFullyRegistered = useFullyRegistered();
  const [restoringSession, setRestoringSession] = useState(false);
  const [hydratingMe, setHydratingMe] = useState(false);
  useUnreadBadge(!!isAuthenticated); // Updates document.title and favicon from unread store

  // Restore session from httpOnly cookie (30 days) when opening the site in the same browser.
  // Run only after persist rehydration. Only show "restoring" spinner when we actually call refresh
  // (so we don't flash spinner on remount when already authenticated from rehydration).
  useEffect(() => {
    if (!isWeb || !authRehydrated) return;
    if (isAuthenticated) {
      return;
    }
    setRestoringSession(true);
    api
      .post<{ access: string; refresh?: string; user?: User }>("/auth/refresh/")
      .then(({ data }) => {
        if (data.access && data.user) {
          setTokens(data.access, data.refresh ?? "", data.user);
        }
      })
      .catch(() => {})
      .finally(() => setRestoringSession(false));
  }, [authRehydrated, isAuthenticated, setTokens]);

  // Hydrate current user profile when token exists but persisted user is only a stub.
  const needsMeHydration = useMemo(() => {
    if (!isAuthenticated) return false;
    if (!user) return true;
    const phoneEmpty = !String(user.phone || "").trim();
    const nameEmpty = !String(user.display_name || "").trim();
    return phoneEmpty && nameEmpty;
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!isWeb || !authRehydrated) return;
    if (!isAuthenticated || !needsMeHydration || !accessToken) return;
    let cancelled = false;
    setHydratingMe(true);
    authApi
      .me()
      .then(({ data }) => {
        if (cancelled) return;
        setTokens(accessToken, refreshToken ?? "", data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydratingMe(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authRehydrated, isAuthenticated, needsMeHydration, accessToken, refreshToken, setTokens]);

  const showAlphaBanner =
    import.meta.env.VITE_ALPHA_BANNER_ENABLED === "true" && isFullyRegistered;

  const authBootstrapping = !authRehydrated || restoringSession || hydratingMe;

  if (authBootstrapping) {
    return <FullscreenSpinner />;
  }

  return (
    <Suspense fallback={<FullscreenSpinner />}>
      {import.meta.env.DEV && (
        <div
          className="fixed bottom-3 right-3 z-[9999] px-2 py-1 rounded text-xs font-medium bg-amber-500 text-amber-950 shadow-lg pointer-events-none"
          aria-hidden
        >
          dev
        </div>
      )}
      {showAlphaBanner && <AlphaBannerModal />}
      {/* Always mount on app domain so hook order is stable (modals return null when closed). Avoids React error #300. */}
      {!isMarketingSite() && (
        <>
          <PremiumRequiredModal />
          <PremiumPromptPopup />
        </>
      )}
      <Routes>
        {isMarketingSite() ? (
          <>
            <Route path="/" element={<LandingPage />} />
            <Route path="/wiki" element={<WikiLayout />}>
              <Route index element={<WikiIndexPage />} />
              <Route path="chats" element={<WikiChatsPage />} />
              <Route path="referral" element={<WikiReferralPage />} />
              <Route path="security" element={<WikiSecurityPage />} />
              <Route path="channels" element={<WikiChannelsPage />} />
              <Route path="bots" element={<WikiBotsPage />} />
            </Route>
            <Route path="/auth" element={<RedirectToApp />} />
            <Route path="/downloads/desktop" element={<RedirectToApp />} />
            <Route path="/downloads/android" element={<RedirectToApp />} />
            <Route path="/telegram-3-shaga" element={<RedirectToApp />} />
            <Route path="/landing2" element={<RedirectToApp />} />
            <Route path="/chats" element={<RedirectToApp />} />
            <Route path="/chats/settings" element={<RedirectToApp />} />
            <Route path="/chat/:chatId" element={<RedirectToApp />} />
            <Route path="/channel/:channelId" element={<RedirectToApp />} />
            <Route path="/chat/join" element={<RedirectToApp />} />
            <Route path="/chat/join/:slug" element={<RedirectToApp />} />
            <Route path="/u/:username" element={<RedirectToApp />} />
            <Route path="/admin" element={<RedirectToApp />} />
            <Route path="*" element={<NotFoundPage />} />
          </>
        ) : (
          <>
            <Route path="/" element={(isStandalone() || import.meta.env.VITE_LANDING_AT_ROOT === "true") ? (isFullyRegistered ? <Navigate to="/chats" replace /> : <Navigate to="/auth" replace />) : (isFullyRegistered ? <Navigate to="/chats" replace /> : <Navigate to="/auth" replace />)} />
            <Route path="/wiki/*" element={<RedirectToWiki />} />
            <Route path="/auth" element={<AuthRoute isFullyRegistered={isFullyRegistered} />} />
            <Route path="/downloads/desktop" element={<DesktopDownloadPage />} />
            <Route path="/downloads/android" element={<AndroidDownloadPage />} />
            <Route path="/telegram-3-shaga" element={<Telegram3StepsLandingPage />} />
            <Route path="/landing2" element={<Lending2Page />} />
            <Route path="/chats" element={<AndroidWebBlocker><RequireFullyRegistered isFullyRegistered={isFullyRegistered}><MessengerPage /></RequireFullyRegistered></AndroidWebBlocker>} />
            <Route path="/chats/settings" element={<AndroidWebBlocker><RequireFullyRegistered isFullyRegistered={isFullyRegistered}><MessengerPage /></RequireFullyRegistered></AndroidWebBlocker>} />
            <Route path="/chat/:chatId" element={<AndroidWebBlocker><RequireFullyRegistered isFullyRegistered={isFullyRegistered}><MessengerPage /></RequireFullyRegistered></AndroidWebBlocker>} />
            <Route path="/channel/:channelId" element={<AndroidWebBlocker><RequireFullyRegistered isFullyRegistered={isFullyRegistered}><MessengerPage /></RequireFullyRegistered></AndroidWebBlocker>} />
            <Route path="/chat/join" element={<JoinChatRoute />} />
            <Route path="/chat/join/:slug" element={<JoinChatRoute />} />
            <Route path="/u/:username" element={<AndroidWebBlocker><UsernameDeepLinkRoute /></AndroidWebBlocker>} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </>
        )}
      </Routes>
    </Suspense>
  );
}

export default App;
