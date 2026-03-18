export interface ReactionDef {
  emoji: string;
  label: string;
  animationUrl?: string;
}

export const REACTIONS: ReactionDef[] = [
  { emoji: "\u{1F525}", label: "Огонёк", animationUrl: "/animations/reactions/fire.json" },
  { emoji: "\u{1F44D}", label: "Нравится" },
  { emoji: "\u{2764}\u{FE0F}", label: "Сердце", animationUrl: "/animations/reactions/heart.json" },
  { emoji: "\u{1F602}", label: "Смех" },
  { emoji: "\u{1F970}", label: "Нежность" },
  { emoji: "\u{1F44F}", label: "Аплодисменты" },
  { emoji: "\u{1F601}", label: "Улыбка" },
  { emoji: "\u{1F914}", label: "Задумался" },
  { emoji: "\u{1F62D}", label: "Слёзы" },
  { emoji: "\u{1F64F}", label: "Спасибо" },
  { emoji: "\u{1F618}", label: "Поцелуй" },
  { emoji: "\u{1F44C}", label: "Отлично" },
  { emoji: "\u{1F60D}", label: "Восхищение" },
  { emoji: "\u{1F389}", label: "Праздник", animationUrl: "/animations/reactions/party.json" },
  { emoji: "\u{1F92F}", label: "Шок" },
];

export const REACTION_BY_EMOJI = new Map(REACTIONS.map((r) => [r.emoji, r]));
