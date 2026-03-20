import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function WikiChatsPage() {
  useDocumentHead(
    "Как создать чат, пригласить по ссылке, голосовое и отложенное сообщение",
    "Инструкция: как создать чат (группу), пригласить по ссылке, отправить голосовое сообщение, отложенное сообщение, отключить уведомления. Лимиты участников и роли."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Чаты: как создать, пригласить и пользоваться
      </h1>
      <p className="text-slate-600 mb-8">
        Пошаговая инструкция: как создать чат (группу), как пригласить в чат по ссылке, как отправлять голосовые и отложенные сообщения, отключить уведомления и увеличить лимит участников.
      </p>

      <section id="create">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как создать чат (группу)</h2>
        <ol className="list-decimal pl-6 space-y-2 text-slate-700">
          <li>Войдите в платформу (по номеру телефона, код приходит в SMS или в Telegram).</li>
          <li>В меню или на главном экране выберите <strong>«Создать чат»</strong>.</li>
          <li>Укажите <strong>название</strong> чата, при желании — описание и аватарку.</li>
          <li>Выберите тип чата: <strong>Открытый</strong> (по ссылке сразу участник) или <strong>Закрытый</strong> (заявка, одобряет владелец).</li>
          <li>Сохраните. Чат создан; пригласительная ссылка вида <code>…/chat/join/ИДЕНТИФИКАТОР?code=КОД</code> — её можно скопировать и отправить участникам.</li>
        </ol>
        <p className="text-slate-600 text-sm mt-2">В группе до <strong>10 000 участников</strong>.</p>
      </section>

      <section id="invite">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как пригласить в чат по ссылке</h2>
        <p className="text-slate-700">
          В настройках чата откройте <strong>пригласительную ссылку</strong>, скопируйте и отправьте друзьям. В <strong>открытом чате</strong> по ссылке человек сразу станет участником; в <strong>закрытом</strong> — отправится заявка, одобряет владелец. Попасть в чат можно только по этой ссылке — поиска чатов по имени нет.
        </p>
      </section>

      <section id="members">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Сколько человек может быть в чате</h2>
        <p className="text-slate-700">В группе может быть до <strong>10 000 участников</strong>.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что можно отправлять в чате</h2>
        <p className="text-slate-700">Текст, файлы (до 2 ГБ), голосовые сообщения (с волной), видео и видео-кружочки, эмодзи. В одном сообщении — несколько файлов. На сообщения — реакции (до трёх на одно сообщение от пользователя).</p>
      </section>

      <section id="voice">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как отправить голосовое сообщение</h2>
        <p className="text-slate-700">Откройте чат → в поле ввода найдите кнопку микрофона → нажмите и удерживайте, говорите → отпустите. Сообщение отправится с визуализацией волны.</p>
      </section>

      <section id="scheduled">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как отправить отложенное сообщение</h2>
        <p className="text-slate-700">Есть отправка <strong>один раз</strong> в выбранное время, <strong>каждый день</strong> или <strong>раз в неделю</strong>. Напишите текст → выберите «Отправить позже» / «Запланировать» → укажите дату и время (и тип повтора) → подтвердите. Запланированные можно отменить до отправки.</p>
      </section>

      <section id="mute">
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как отключить уведомления в чате</h2>
        <p className="text-slate-700">Откройте чат → настройки чата (шестерёнка или меню у названия) → включите <strong>«Беззвучный режим»</strong>. Звук и пуши от этого чата отключатся; читать и писать можно по-прежнему.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Роли в чате</h2>
        <p className="text-slate-700"><strong>Владелец</strong> — создал чат, меняет название/описание/аватар, удаляет чат, одобряет заявки (в закрытых), исключает участников. <strong>Администратор</strong> — может исключать участников (кроме владельца). <strong>Участник</strong> — пишет, ставит реакции, беззвучный режим, может выйти.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Подписка</h2>
        <p className="text-slate-700">Пользоваться чатами можно на free-плане. Premium нужен только для расширенных возможностей и оформляется отдельно через YooKassa.</p>
      </section>

      <p className="mt-10 text-slate-500 text-sm">
        <Link to="/wiki" className="text-blue-600 hover:underline">← Wiki</Link>
        {" · "}
        <Link to="/wiki/referral" className="text-blue-600 hover:underline">Реферальная программа →</Link>
      </p>
    </article>
  );
}
