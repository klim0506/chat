import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function SpravkaSecurityPage() {
  useDocumentHead(
    "Безопасность чатов: вход по коду, защита доступа, файлы",
    "Как устроена безопасность: вход без пароля по SMS и Telegram, доступ в чат только по ссылке, защита файлов. Безопасны ли чаты и личные данные."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Безопасность чатов и аккаунта
      </h1>
      <p className="text-slate-600 mb-8">
        Как происходит вход (без пароля, по коду), кто может видеть чаты, как защищены файлы и можно ли «найти чат в поиске».
      </p>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как войти в аккаунт: без пароля, по коду</h2>
        <p className="text-slate-700">Вход только по номеру телефона. Вы вводите номер → на него отправляется одноразовый код по SMS или в Telegram → вводите код и получаете доступ. Пароль не используется. Сессия — в виде токенов (JWT). Действуют ограничения частоты запросов кода и попыток ввода с одного IP.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Кто может видеть чаты</h2>
        <p className="text-slate-700">Список чатов видит только авторизованный пользователь и только те чаты, где он участник. Попасть в чат можно только по пригласительной ссылке с правильным кодом (криптографическая проверка). Чаты приватные по умолчанию — не видно в поиске.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как защищены файлы</h2>
        <p className="text-slate-700">Загрузка — только авторизованным; при привязке к чату проверяется участие. Скачивание и просмотр — по временной подписанной ссылке (ограниченный срок и подпись). Постоянные прямые ссылки в открытый доступ не выдаются.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Сессии и токены</h2>
        <p className="text-slate-700">После ввода кода выдаётся пара JWT: access (для API и WebSocket) и refresh (только для обновления access). Refresh нельзя использовать вместо access. На обновление токена тоже действует rate limit.</p>
      </section>

      <p className="mt-10 text-slate-500 text-sm">
        <Link to="/spravka/referral" className="text-blue-600 hover:underline">← Реферальная программа</Link>
        {" · "}
        <Link to="/spravka" className="text-blue-600 hover:underline">Справка</Link>
        {" · "}
        <Link to="/spravka/channels" className="text-blue-600 hover:underline">Каналы →</Link>
      </p>
    </article>
  );
}
