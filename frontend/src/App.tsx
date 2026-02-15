import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { useUnreadBadge } from "./hooks/useUnreadBadge";

// Lazy-loaded pages — каждая страница загружается отдельным чанком
const AuthPage = lazy(() => import("./pages/AuthPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const MessengerPage = lazy(() => import("./pages/MessengerPage"));
const JoinChatPage = lazy(() => import("./pages/JoinChatPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const SpravkaLayout = lazy(() => import("./pages/spravka/SpravkaLayout"));
const SpravkaIndexPage = lazy(() => import("./pages/spravka/SpravkaIndexPage"));
const SpravkaChatsPage = lazy(() => import("./pages/spravka/SpravkaChatsPage"));
const SpravkaReferralPage = lazy(() => import("./pages/spravka/SpravkaReferralPage"));
const SpravkaSecurityPage = lazy(() => import("./pages/spravka/SpravkaSecurityPage"));
const SpravkaChannelsPage = lazy(() => import("./pages/spravka/SpravkaChannelsPage"));
const SpravkaBotsPage = lazy(() => import("./pages/spravka/SpravkaBotsPage"));

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

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen"><div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/spravka" element={<SpravkaLayout />}>
          <Route index element={<SpravkaIndexPage />} />
          <Route path="chats" element={<SpravkaChatsPage />} />
          <Route path="referral" element={<SpravkaReferralPage />} />
          <Route path="security" element={<SpravkaSecurityPage />} />
          <Route path="channels" element={<SpravkaChannelsPage />} />
          <Route path="bots" element={<SpravkaBotsPage />} />
        </Route>
        <Route path="/chats" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        <Route path="/chats/settings" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        {/* Redirect old /dashboard URLs */}
        <Route path="/dashboard" element={<Navigate to="/chats" replace />} />
        <Route path="/dashboard/settings" element={<Navigate to="/chats/settings" replace />} />
        <Route path="/chat/:chatId" element={isFullyRegistered ? <MessengerPage /> : <Navigate to="/auth" replace />} />
        <Route path="/chat/join" element={<JoinChatRoute />} />
        <Route path="/chat/join/:slug" element={<JoinChatRoute />} />
        <Route path="/settings" element={isFullyRegistered ? <SettingsPage /> : <Navigate to="/auth" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
