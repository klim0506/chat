import { Link } from "react-router-dom";
import { useDocumentHead } from "../../hooks/useDocumentHead";

export default function WikiReferralPage() {
  useDocumentHead(
    "Реферальная программа: как получить ссылку, звёзды за приглашение",
    "Как получить реферальную ссылку в платформе чатов, сколько звёзд дают за приглашение друга, как потратить звёзды на расширение чата."
  );

  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
        Реферальная программа: как получить ссылку и звёзды
      </h1>
      <p className="text-slate-600 mb-8">
        Как получить реферальную ссылку, сколько звёзд дают за приглашение друга, что получает приглашённый.
      </p>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Как получить реферальную ссылку</h2>
        <p className="text-slate-700">Войдите в платформу → профиль или настройки → блок <strong>«Реферальная программа»</strong>. Там ваш реферальный код. Ссылка вида <code>https://ваш-домен/auth?ref=ВАШ_КОД</code>. Скопируйте и отправьте друзьям. При нехватке звёзд в чате показывается подсказка с кнопкой «Скопировать» реферальную ссылку.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что получает приглашённый</h2>
        <ul className="list-disc pl-6 text-slate-700">
          <li><strong>14 дней</strong> пробного периода подписки вместо 7.</li>
          <li><strong>10 звёзд</strong> сразу после регистрации.</li>
        </ul>
        <p className="text-slate-600 text-sm mt-2">Нужно перейти по вашей ссылке (с <code>ref=...</code>) и войти/зарегистрироваться по ней.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Что получает пригласивший</h2>
        <p className="text-slate-700"><strong>10 звёзд</strong> за каждого нового пользователя по вашей реферальной ссылке. Звёзды начисляются один раз за каждого. Группы поддерживают до 10 000 участников (<Link to="/wiki/chats" className="text-blue-600 hover:underline">Чаты</Link>).</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-slate-900 mt-10 mb-3">Зачем нужны звёзды</h2>
        <p className="text-slate-700">Группы поддерживают до 10 000 участников. Актуальные способы траты звёзд — в приложении.</p>
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
