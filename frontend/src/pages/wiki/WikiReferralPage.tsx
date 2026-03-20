import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function WikiReferralPage() {
  useDocumentHead(
    "Реферальная программа: как получить ссылку и Premium за приглашения",
    "Как работает реферальная программа Pingy: где взять ссылку, какие пороги дают Premium и когда начисляется награда."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Реферальная программа: как получить Premium за приглашения
      </h1>
      <p className="text-slate-600 mb-8">
        В Pingy никто не получает Premium автоматически при регистрации. Premium можно заработать в реферальной
        программе: награда начисляется пригласившему пользователю после достижения порога и его следующего входа.
      </p>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как получить реферальную ссылку</h2>
        <p className="text-slate-700">
          Откройте профиль или настройки и найдите блок <strong>«Реферальная программа»</strong>. Там будет ваша
          ссылка вида <code>https://ваш-домен/auth?ref=ВАШ_КОД</code>. Её можно скопировать и отправить друзьям.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что получает приглашённый</h2>
        <p className="text-slate-700">
          Приглашённый пользователь регистрируется по обычному free-плану. Реферальная ссылка не даёт стартовый
          Premium и не выдаёт дополнительные бонусы приглашённому.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что получает пригласивший</h2>
        <ul className="list-disc pl-6 text-slate-700">
          <li>10 приглашённых пользователей: 1 месяц Premium.</li>
          <li>40 приглашённых пользователей: 6 месяцев Premium.</li>
          <li>80 приглашённых пользователей: 12 месяцев Premium.</li>
        </ul>
        <p className="text-slate-600 text-sm mt-2">
          Награда начисляется один раз за каждый достигнутый порог и выдается в первый следующий успешный вход
          пригласившего пользователя.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Важно помнить</h2>
        <p className="text-slate-700">
          Если Premium нужен сразу, в приложении доступна пробная неделя за 11 ₽, затем действует автопродление
          299 ₽/мес. Автопродление можно остановить отвязкой карты в настройках оплаты.
        </p>
      </section>

      <p className="mt-10 text-slate-500 text-sm">
        <Link to="/wiki/chats" className="text-blue-600 hover:underline">← Чаты</Link>
        {" · "}
        <Link to="/wiki" className="text-blue-600 hover:underline">Wiki</Link>
        {" · "}
        <Link to="/wiki/security" className="text-blue-600 hover:underline">Безопасность →</Link>
      </p>
    </article>
  );
}
