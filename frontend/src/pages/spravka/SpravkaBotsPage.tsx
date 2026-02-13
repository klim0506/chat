import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function SpravkaBotsPage() {
  useDocumentHead(
    "Боты в чатах: есть ли боты как в Telegram",
    "Есть ли боты в платформе приватных чатов. Чем отличается служебный бот для кода входа. Когда появятся боты в чатах — актуальный статус."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Боты в чатах: есть ли (как в Telegram)
      </h1>
      <p className="text-slate-600 mb-8">
        Ответы на запросы вроде «как добавить бота в чат», «есть ли боты как в телеграм».
      </p>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Есть ли боты в чатах?</h2>
        <p className="text-slate-700"><strong>Пользовательских ботов в чатах пока нет.</strong> Нельзя добавить бота для уведомлений, автоматизации или игр (как в Telegram). Если такая возможность появится — инструкции будут в справке и в приложении.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Служебный бот для входа</h2>
        <p className="text-slate-700">В системе используется только один служебный бот — для доставки кода входа в Telegram (чтобы не тратить SMS). Он не участвует в ваших чатах, не видит переписки и не добавляется в чаты как участник. «Бот в чате» как собеседник или помощник в платформе не поддерживается.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что есть вместо ботов</h2>
        <p className="text-slate-700"><Link to="/spravka/chats" className="text-blue-600 hover:underline">Чаты</Link> с участниками: сообщения, файлы, голосовые, видео, реакции, отложенные сообщения. <Link to="/spravka/referral" className="text-blue-600 hover:underline">Реферальная программа</Link> для приглашения друзей и получения звёзд.</p>
      </section>

      <p className="mt-10 text-slate-500 text-sm">
        <Link to="/spravka/channels" className="text-blue-600 hover:underline">← Каналы</Link>
        {" · "}
        <Link to="/spravka" className="text-blue-600 hover:underline">Справка</Link>
      </p>
    </article>
  );
}
