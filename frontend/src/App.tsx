import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import MessengerPage from "./pages/MessengerPage";
import CreateChatPage from "./pages/CreateChatPage";
import JoinChatPage from "./pages/JoinChatPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import SpravkaLayout from "./pages/spravka/SpravkaLayout";
import SpravkaIndexPage from "./pages/spravka/SpravkaIndexPage";
import SpravkaChatsPage from "./pages/spravka/SpravkaChatsPage";
import SpravkaReferralPage from "./pages/spravka/SpravkaReferralPage";
import SpravkaSecurityPage from "./pages/spravka/SpravkaSecurityPage";
import SpravkaChannelsPage from "./pages/spravka/SpravkaChannelsPage";
import SpravkaBotsPage from "./pages/spravka/SpravkaBotsPage";

function JoinChatRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (isAuthenticated) return <JoinChatPage />;
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/auth?next=${next}`} replace />;
}

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
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
      <Route path="/dashboard" element={isAuthenticated ? <MessengerPage /> : <Navigate to="/auth" replace />} />
      <Route path="/dashboard/settings" element={isAuthenticated ? <MessengerPage /> : <Navigate to="/auth" replace />} />
      <Route path="/dashboard/create" element={isAuthenticated ? <CreateChatPage /> : <Navigate to="/auth" replace />} />
      <Route path="/chat/:chatId" element={isAuthenticated ? <MessengerPage /> : <Navigate to="/auth" replace />} />
      <Route path="/chat/join" element={<JoinChatRoute />} />
      <Route path="/chat/join/:slug" element={<JoinChatRoute />} />
      <Route path="/settings" element={isAuthenticated ? <SettingsPage /> : <Navigate to="/auth" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
