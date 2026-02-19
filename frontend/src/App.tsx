import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { useUnreadBadge } from "./hooks/useUnreadBadge";
import { isStandalone } from "./lib/pwa";
import { AlphaBannerModal } from "./components/AlphaBannerModal";

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

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isFullyRegistered = useFullyRegistered();
  useUnreadBadge(!!isAuthenticated); // Updates document.title and favicon from unread store

  const showAlphaBanner =
    import.meta.env.VITE_ALPHA_BANNER_ENABLED === "true" && isFullyRegistered;

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen"><div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>}>
      {showAlphaBanner && <AlphaBannerModal />}
      <Routes>
        <Route path="/" element={isStandalone() ? (isFullyRegistered ? <Navigate to="/chats" replace /> : <Navigate to="/auth" replace />) : <LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/downloads/desktop" element={<DesktopDownloadPage />} />
        <Route path="/downloads/android" element={<AndroidDownloadPage />} />
        <Route path="/telegram-3-shaga" element={<Telegram3StepsLandingPage />} />
        <Route path="/landing2" element={<Lending2Page />} />
        <Route path="/wiki" element={<WikiLayout />}>
          <Route index element={<WikiIndexPage />} />
          <Route path="chats" element={<WikiChatsPage />} />
          <Route path="referral" element={<WikiReferralPage />} />
          <Route path="security" element={<WikiSecurityPage />} />
          <Route path="channels" element={<WikiChannelsPage />} />
          <Route path="bots" element={<WikiBotsPage />} />
        </Route>
        <Route path="/chats" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        <Route path="/chats/settings" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        <Route path="/chat/:chatId" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        <Route path="/chat/join" element={<JoinChatRoute />} />
        <Route path="/chat/join/:slug" element={<JoinChatRoute />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
