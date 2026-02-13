import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function SpravkaIndexPage() {
  useDocumentHead(
    "Справка — Платформа приватных чатов | Как пользоваться мессенджером",
    "Полная инструкция по платформе приватных чатов: как создать чат, пригласить по ссылке, отправить голосовое, настроить отложенные сообщения. Ответы на частые вопросы."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Справка: как пользоваться платформой приватных чатов
      </h1>
      <p className="text-slate-600 lead mb-6">
        <strong>Платформа приватных чатов</strong> — это мессенджер с входом по номеру телефона, чатами по пригласительным ссылкам и доставкой сообщений в реальном времени. Здесь вы найдёте пошаговые инструкции: как создать чат, как пригласить в чат по ссылке, как отправить голосовое или отложенное сообщение.
      </p>

      <h2 className="text-xl font-bold text-slate-900 mt-8 mb-4">Быстрые ответы на частые вопросы</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left p-3 font-semibold text-slate-900">Вопрос</th>
              <th className="text-left p-3 font-semibold text-slate-900">Краткий ответ</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#create" className="text-blue-600 hover:underline">Как создать чат (группу)?</Link></td><td className="p-3">В меню выберите «Создать чат», укажите название, тип (открытый/закрытый) — получите пригласительную ссылку.</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#invite">Как пригласить в чат по ссылке?</Link></td><td className="p-3">Скопируйте пригласительную ссылку в настройках чата и отправьте друзьям. По ссылке можно вступить сразу (открытый) или подать заявку (закрытый).</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#voice">Как отправить голосовое сообщение?</Link></td><td className="p-3">В поле ввода нажмите и удерживайте кнопку микрофона, запишите сообщение и отпустите.</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#scheduled">Как отправить отложенное сообщение?</Link></td><td className="p-3">Выберите «Отправить позже» / отложенная отправка, укажите дату и время (или повтор: каждый день / раз в неделю).</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#mute">Как отключить уведомления в чате?</Link></td><td className="p-3">В чате включите беззвучный режим (иконка колокольчика / настройки чата).</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/chats#members">Как увеличить число участников?</Link></td><td className="p-3">Владелец может «прокачать» чат за звёзды: до 100 (50 звёзд) или до 1000 (100 звёзд). Звёзды даёт <Link to="/spravka/referral">реферальная программа</Link>.</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/referral">Реферальная ссылка: как получить и зачем?</Link></td><td className="p-3">Реферальный код есть в профиле/настройках. Ссылка вида …/auth?ref=КОД. За приглашённого — 10 звёзд вам и 14 дней trial ему.</td></tr>
            <tr className="border-t border-slate-100"><td className="p-3"><Link to="/spravka/security">Безопасно ли: вход без пароля, доступ к чатам?</Link></td><td className="p-3">Вход по одноразовому коду (SMS или Telegram). В чат можно попасть только по пригласительной ссылке.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-xl font-bold text-slate-900 mt-10 mb-4">Разделы справки</h2>
      <ul className="list-disc pl-6 space-y-2 text-slate-700">
        <li><Link to="/spravka/chats" className="text-blue-600 hover:underline">Чаты: создание, приглашение, сообщения</Link> — как создать чат и группу, пригласить по ссылке, голосовые, видео, отложенные сообщения.</li>
        <li><Link to="/spravka/referral" className="text-blue-600 hover:underline">Реферальная программа</Link> — как получить реферальную ссылку, звёзды за приглашение, как потратить звёзды.</li>
        <li><Link to="/spravka/security" className="text-blue-600 hover:underline">Безопасность чатов</Link> — вход по коду (SMS/Telegram), защита доступа к чатам и файлам.</li>
        <li><Link to="/spravka/channels" className="text-blue-600 hover:underline">Каналы</Link> — есть ли каналы в платформе (как в Telegram).</li>
        <li><Link to="/spravka/bots" className="text-blue-600 hover:underline">Боты</Link> — есть ли боты в чатах, служебный бот для кодов входа.</li>
      </ul>

      <p className="text-slate-500 text-sm mt-8">
        Инструкции актуальны на момент обновления справки. Точные тарифы и кнопки смотрите в интерфейсе приложения.
      </p>
    </article>
  );
}
