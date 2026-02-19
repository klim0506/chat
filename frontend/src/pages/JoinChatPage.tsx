import { useEffect, useState } from "react";
import { useSearchParams, useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { chatsApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { LOGO_URL } from "../lib/constants";

export default function JoinChatPage() {
  const { t } = useTranslation();
  const { slug: slugParam } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const slug = slugParam || searchParams.get("slug") || "";
  const code = searchParams.get("code") || "";
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "pending" | "error">("idle");
  const [message, setMessage] = useState("");

  const join = () => {
    if (!slug || !code) {
      setMessage(t("joinPage.missingParams"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setMessage("");
    chatsApi.join(slug, code)
      .then((res) => {
        const data = res.data as { detail?: string; id: string; already_member?: boolean };
        const detail = data?.detail;
        if (detail?.includes("Ожидайте подтверждения")) {
          setStatus("pending");
          setMessage(t("joinChat.pendingApproval"));
        } else {
          setStatus("joined");
          setMessage(data.already_member ? t("joinPage.alreadyInChat") : t("joinChat.joined"));
          setTimeout(() => navigate(`/chat/${data.id}`), 1500);
        }
      })
      .catch((e) => {
        const status = e?.response?.status;
        if (status === 401) {
          const next = encodeURIComponent(`${location.pathname}${location.search}`);
          navigate(`/auth?next=${next}`, { replace: true });
          return;
        }
        setMessage(e?.response?.data?.detail || "Не удалось вступить в чат.");
        setStatus("error");
      });
  };

  useEffect(() => {
    if (slug && code) join();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 relative">
      <div className="absolute left-4 top-4">
        <img src={LOGO_URL} alt="Логотип" className="h-[3.75rem] w-auto object-contain" />
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="bg-white rounded-xl border p-6 max-w-md w-full text-center">
        <h1 className="text-xl font-semibold text-slate-800 mb-4">Вступление в чат</h1>
        {!slug || !code ? (
          <div className="text-left space-y-4">
            <p className="text-slate-600">
              Чтобы вступить в чат, перейдите по <strong>пригласительной ссылке</strong>, которую вам отправил владелец чата (в мессенджере, по почте или в приложении).
            </p>
            <p className="text-slate-500 text-sm">
              Ссылка обычно выглядит так: <code className="bg-slate-100 px-1 rounded text-xs break-all">…/chat/join/название-чата?code=XXXX</code>
            </p>
            <p className="text-slate-500 text-sm">
              Скопируйте полную ссылку и откройте её в браузере — вы вернётесь на эту страницу, и вступление произойдёт автоматически.
            </p>
            <Link to="/chats" className="inline-block text-blue-600 hover:underline text-sm font-medium">
              ← Вернуться в чаты
            </Link>
          </div>
        ) : status === "loading" ? (
          <p className="text-slate-600">{t("common.loading")}</p>
        ) : status === "joined" || status === "pending" ? (
          <p className="text-green-600">{message}</p>
        ) : status === "error" ? (
          <>
            <p className="text-red-500 mb-4">{message}</p>
            <button onClick={join} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Повторить</button>
          </>
        ) : (
          <button onClick={join} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Вступить в чат</button>
        )}
      </div>
      </div>
    </div>
  );
}
