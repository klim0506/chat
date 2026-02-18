import { Link } from "react-router-dom";
import { useDocumentHead } from "../hooks/useDocumentHead";
import { useAuthStore } from "../store/auth";
import "./Lending2Page.css";

type QuickNewsItem = {
  date: string;
  title: string;
};

type NewsCard = {
  title: string;
  description: string;
  date: string;
  coverClass: string;
};

type Reason = {
  icon: string;
  title: string;
  text: string;
};

type FooterItem = {
  label: string;
  to?: string;
  href?: string;
};

type FooterColumn = {
  title: string;
  items: FooterItem[];
};

const quickNews: QuickNewsItem[] = [
  {
    date: "9 фев.",
    title: "Новый дизайн, изготовление подарков и многое другое",
  },
  {
    date: "3 янв.",
    title: "Краткие пересказы от ИИ, новый дизайн и многое другое",
  },
  {
    date: "12 дек.",
    title: "Ключи доступа, предложения о покупке подарков и многое другое",
  },
];

const newsCards: NewsCard[] = [
  {
    title: "Новый дизайн, изготовление подарков и многое другое",
    description:
      "Сегодня мы представляем большое обновление интерфейса Pingy для Android, включая набор новых визуальных тем и анимаций.",
    date: "9 фев. 2026",
    coverClass: "tg2-news-cover--warm",
  },
  {
    title: "Краткие пересказы от ИИ, новый дизайн и многое другое",
    description:
      "В первом обновлении 2026 года мы добавили набор подсказок от ИИ и обновили внешний вид чатов на iOS и Web.",
    date: "3 янв. 2026",
    coverClass: "tg2-news-cover--cool",
  },
];

const reasons: Reason[] = [
  {
    icon: "tl_card_wecandoit.gif",
    title: "Удобство",
    text: "Простой, интуитивный интерфейс.",
  },
  {
    icon: "tl_card_secure.gif",
    title: "Шифрование",
    text: "Конфиденциальность и удаление данных по таймеру.",
  },
  {
    icon: "tl_card_synchronize.gif",
    title: "Синхронизация",
    text: "Доступ с нескольких устройств одновременно.",
  },
  {
    icon: "tl_card_fast.gif",
    title: "Скорость",
    text: "Сообщения приходят быстрее, чем в любом другом приложении.",
  },
  {
    icon: "tl_card_cloud.gif",
    title: "Файлы",
    text: "Нет ограничений на размер мультимедиа и архивов.",
  },
  {
    icon: "tl_card_open.gif",
    title: "Открытость",
    text: "Открытый исходный код и API для разработчиков.",
  },
  {
    icon: "tl_card_private.gif",
    title: "Безопасность",
    text: "Данные защищены от перехвата и взлома.",
  },
  {
    icon: "tl_card_connect.gif",
    title: "Социальность",
    text: "Групповые чаты размером до 200 000 участников.",
  },
  {
    icon: "tl_card_decentralized.gif",
    title: "Гибкость",
    text: "Можно выбрать цвета и оформление под себя.",
  },
];

const footerColumns: FooterColumn[] = [
  {
    title: "Pingy",
    items: [
      { label: "О проекте", to: "/" },
      { label: "Для мобильных и компьютеров", href: "#apps" },
      { label: "Быстрый и безопасный чат", href: "#reasons" },
    ],
  },
  {
    title: "О Pingy",
    items: [
      { label: "FAQ", href: "#faq" },
      { label: "Приватность", to: "/spravka/security" },
      { label: "Для СМИ", to: "/spravka" },
    ],
  },
  {
    title: "Для мобильных",
    items: [
      { label: "Android", to: "/telegram-3-shaga" },
      { label: "iPhone / iPad", to: "/telegram-3-shaga" },
      { label: "Мобильная web-версия", to: "/auth" },
    ],
  },
  {
    title: "Для компьютера",
    items: [
      { label: "PC / Mac / Linux", to: "/telegram-3-shaga" },
      { label: "Desktop клиент", to: "/telegram-3-shaga" },
      { label: "Web-клиент", to: "/auth" },
    ],
  },
  {
    title: "Платформы",
    items: [
      { label: "API", to: "/spravka" },
      { label: "Переводы", to: "/spravka" },
      { label: "Instant View", to: "/spravka" },
    ],
  },
];

function FooterLink({ item }: { item: FooterItem }) {
  if (item.to) {
    return <Link to={item.to}>{item.label}</Link>;
  }
  if (item.href) {
    return <a href={item.href}>{item.label}</a>;
  }
  return <span className="tg2-footer-text">{item.label}</span>;
}

export default function Lending2Page() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const dashboardLink = isAuthenticated ? "/chats" : "/auth";
  const dashboardLabel = isAuthenticated ? "Открыть чаты" : "Log in";
  const assetBase = import.meta.env.BASE_URL;
  const asset = (fileName: string) => `${assetBase}lending2/${fileName}`;

  useDocumentHead(
    "Pingy — новая эра в общении",
    "Pingy: быстрый мессенджер в стиле Telegram с приложениями для всех платформ.",
  );

  return (
    <div className="tg2-page">
      <header className="tg2-header">
        <div className="tg2-container tg2-header-inner">
          <nav className="tg2-main-nav">
            <a href="#home" className="is-active">
              Главная
            </a>
            <a href="#faq">FAQ</a>
            <a href="#apps">Приложения</a>
            <Link to="/spravka">API</Link>
            <Link to="/spravka/security">Модерация</Link>
          </nav>
          <div className="tg2-meta-nav">
            <a href="#home">RU</a>
            <a href="https://twitter.com/telegram" target="_blank" rel="noreferrer">
              Twitter
            </a>
            <Link to={dashboardLink} className="tg2-open-chats-btn">
              {dashboardLabel}
            </Link>
          </div>
        </div>
      </header>

      <main className="tg2-container">
        <section className="tg2-hero" id="home">
          <div className="tg2-brand">
            <img src={asset("t_logo_2x.png")} alt="Pingy" className="tg2-logo" />
            <h1>Pingy</h1>
            <p>новая эра в общении</p>
          </div>
          <aside className="tg2-quick-news">
            <h2>Свежие новости</h2>
            <ul>
              {quickNews.map((item) => (
                <li key={item.title}>
                  <strong>{item.date}</strong>
                  <p>{item.title}</p>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section className="tg2-platforms" id="apps">
          <div className="tg2-mobile-platforms">
            <article className="tg2-platform-card tg2-platform-card--android">
              <img src={asset("SiteAndroid_2x.jpg")} alt="Pingy для Android" className="tg2-platform-image" />
              <Link to="/telegram-3-shaga" className="tg2-platform-link tg2-platform-link--active">
                <img src={asset("SiteIconAndroid.svg")} alt="" aria-hidden="true" />
                Pingy для Android
              </Link>
            </article>
            <article className="tg2-platform-card tg2-platform-card--ios">
              <img src={asset("SiteiOS_2x.jpg")} alt="Pingy для iPhone / iPad" className="tg2-platform-image" />
              <Link to="/telegram-3-shaga" className="tg2-platform-link">
                <img src={asset("SiteIconApple.svg")} alt="" aria-hidden="true" />
                Pingy для iPhone / iPad
              </Link>
            </article>
          </div>
          <article className="tg2-desktop-platform">
            <img src={asset("SiteDesktop_2x.jpg")} alt="Pingy для ПК и macOS" className="tg2-desktop-image" />
            <div className="tg2-desktop-links">
              <Link to="/telegram-3-shaga">Pingy для PC / Linux</Link>
              <Link to="/telegram-3-shaga">Pingy для macOS</Link>
            </div>
          </article>
        </section>

        <section className="tg2-news" id="news">
          <h2>Свежие новости</h2>
          <div className="tg2-news-grid">
            {newsCards.map((card) => (
              <article key={card.title} className="tg2-news-card">
                <div className={`tg2-news-cover ${card.coverClass}`} aria-hidden="true" />
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <time>{card.date}</time>
              </article>
            ))}
          </div>
        </section>

        <section className="tg2-reasons" id="reasons">
          <h2>Девять причин пользоваться Pingy</h2>
          <div className="tg2-reasons-grid">
            {reasons.map((reason) => (
              <article key={reason.title} className="tg2-reason-card">
                <img src={asset(reason.icon)} alt={reason.title} className="tg2-reason-icon" />
                <h3>{reason.title}</h3>
                <p>{reason.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="tg2-faq" id="faq">
          <h2>FAQ</h2>
          <article>
            <h3>Pingy — это копия Telegram?</h3>
            <p>Нет. Это отдельный продукт с похожей философией скорости и простоты, но со своим UX и своими правилами.</p>
          </article>
          <article>
            <h3>Можно начать без установки?</h3>
            <p>Да. Web-версия работает сразу в браузере, регистрация доступна по номеру телефона.</p>
          </article>
          <article>
            <h3>Есть ли группы и большие файлы?</h3>
            <p>Да. Групповые чаты, роли участников, вложения до 2 ГБ и базовая модерация прямо в интерфейсе.</p>
          </article>
        </section>
      </main>

      <footer className="tg2-footer">
        <div className="tg2-container tg2-footer-grid">
          {footerColumns.map((column) => (
            <section key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.items.map((item) => (
                  <li key={item.label}>
                    <FooterLink item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </footer>
    </div>
  );
}
