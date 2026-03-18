import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function WikiChannelsPage() {
  useDocumentHead(
    "Каналы в платформе чатов: есть ли как в Telegram",
    "Есть ли каналы в платформе приватных чатов. Отличие каналов от чатов. Когда появятся каналы — актуальный статус."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Каналы: есть ли в платформе (как в Telegram)
      </h1>
      <p className="text-slate-600 mb-8">
        Ответы на запросы вроде «как создать канал», «есть ли каналы как в телеграм».
      </p>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Есть ли каналы в платформе?</h2>
        <p className="text-slate-700"><strong>Нет. Каналы пока не реализованы.</strong> Сейчас есть только чаты (группы с владельцем и участниками, вход по пригласительной ссылке). Функция каналов (публичные/приватные каналы с подписчиками) в текущей версии не предусмотрена. Когда появятся — описание будет в Wiki и в приложении.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что есть вместо каналов</h2>
        <p className="text-slate-700"><Link to="/wiki/chats" className="text-blue-600 hover:underline">Чаты</Link> — создание чата, приглашение по ссылке, текст, голосовые, файлы, видео, отложенные сообщения.</p>
      </section>

      <p className="mt-10 text-slate-500 text-sm">
        <Link to="/wiki/security" className="text-blue-600 hover:underline">← Безопасность</Link>
        {" · "}
        <Link to="/wiki" className="text-blue-600 hover:underline">Wiki</Link>
        {" · "}
        <Link to="/wiki/bots" className="text-blue-600 hover:underline">Боты →</Link>
      </p>
    </article>
  );
}
