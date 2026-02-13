import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { chatsApi } from "../api/client";

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 300;

const schema = z.object({
  title: z.string().min(1, "Введите название").max(TITLE_MAX, `Максимум ${TITLE_MAX} символов`),
  description: z.string().max(DESCRIPTION_MAX, `Максимум ${DESCRIPTION_MAX} символов`).optional(),
  chat_type: z.enum(["open", "closed"]),
});
type FormData = z.infer<typeof schema>;

export default function CreateChatPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", chat_type: "open" },
  });
  const titleValue = watch("title") ?? "";
  const descriptionValue = watch("description") ?? "";

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    } else {
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
  };

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const copyInviteLink = (url: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const onSubmit = async (data: FormData) => {
    setError("");
    setLoading(true);
    const payload = { title: data.title, chat_type: data.chat_type, description: data.description || "" };
    try {
      const { data: chat } = await chatsApi.create(payload);
      if (avatarFile) {
        // TODO: resize/compress avatar before upload to reduce bandwidth and TTFB.
        await chatsApi.uploadAvatar(chat.id, avatarFile);
      }
      if (chat.invite_link) {
        copyInviteLink(chat.invite_link);
      }
      navigate(`/chat/${chat.id}`, { replace: true, state: { inviteLinkCopied: true } });
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: unknown }; message?: string; code?: string };
      const resData = err.response?.data;
      const status = err.response?.status;
      let msg: string;
      if (resData && typeof resData === "object" && "detail" in resData) {
        const d = (resData as { detail?: string | string[] }).detail;
        msg = Array.isArray(d) ? (d[0] || "") : String(d ?? "");
      } else {
        msg = "";
      }
      if (status === 401) {
        setError("Сессия истекла или вы вышли. Войдите снова.");
      } else if (status === 403 && (msg.includes("подписк") || msg.includes("subscription"))) {
        setError("Для создания чатов нужна активная подписка. Оформите подписку в настройках.");
      } else if (!err.response) {
        setError("Не удалось подключиться к серверу. Запустите бэкенд: в папке backend выполните python manage.py runserver 0.0.0.0:8000");
      } else {
        setError(msg || "Ошибка создания чата");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <a href="/dashboard" className="text-slate-600 hover:text-slate-900">
            &larr; Назад
          </a>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8 max-w-md">
        <h1 className="text-2xl font-semibold text-slate-800 mb-2">Создать чат</h1>
        <p className="text-slate-500 text-sm mb-6">
          Создайте личный или групповой чат. После создания вы сможете пригласить участников по ссылке (в информации о чате).
        </p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-white p-6 rounded-xl border">
          <div className="flex gap-4 items-start">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarChange}
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden shrink-0 border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
              title="Добавить фото"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-slate-400 text-xs font-medium">Нет</span>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-medium text-slate-700 mb-1">Название чата</label>
              <input
                type="text"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                maxLength={TITLE_MAX}
                {...register("title")}
              />
              {titleValue.length >= 30 && (
                <p className={`text-xs mt-0.5 ${titleValue.length >= TITLE_MAX ? "text-red-500 font-medium" : "text-slate-500"}`}>
                  {titleValue.length}/{TITLE_MAX}
                </p>
              )}
              {errors.title && <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 resize-none"
              rows={3}
              maxLength={DESCRIPTION_MAX}
              placeholder="О чём этот чат? (необязательно)"
              {...register("description")}
            />
            <p className="text-xs text-slate-500 text-right mt-0.5">{descriptionValue.length}/{DESCRIPTION_MAX}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Тип чата</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" value="open" {...register("chat_type")} /> Открытый
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" value="closed" {...register("chat_type")} /> Закрытый
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              В открытый чат может войти любой по ссылке. В закрытый — только после одобрения.
            </p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Создание…" : "Создать чат"}
          </button>
        </form>
      </main>
    </div>
  );
}
