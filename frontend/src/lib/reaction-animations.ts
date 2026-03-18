export interface ReactionDef {
  emoji: string;
  label: string;
  animationUrl: string;
}

export const REACTIONS: ReactionDef[] = [
  { emoji: "🔥", label: "Огонь", animationUrl: "/animations/reactions/fire.json" },
  { emoji: "💫", label: "Звёздочка", animationUrl: "/animations/reactions/dizzy.json" },
  { emoji: "✨", label: "Искры", animationUrl: "/animations/reactions/sparkles.json" },
  { emoji: "❤️", label: "Сердце", animationUrl: "/animations/reactions/heart.json" },
  { emoji: "🥰", label: "Влюблённое лицо", animationUrl: "/animations/reactions/love-face.json" },
  { emoji: "😂", label: "Смех", animationUrl: "/animations/reactions/laugh.json" },
  { emoji: "😎", label: "Крутой", animationUrl: "/animations/reactions/cool.json" },
  { emoji: "🎉", label: "Праздник", animationUrl: "/animations/reactions/party.json" },
  { emoji: "🙌", label: "Руки вверх", animationUrl: "/animations/reactions/raised-hands.json" },
  { emoji: "👏", label: "Аплодисменты", animationUrl: "/animations/reactions/clap.json" },
  { emoji: "💪", label: "Сила", animationUrl: "/animations/reactions/strong.json" },
  { emoji: "🤩", label: "Звёздные глаза", animationUrl: "/animations/reactions/star-eyes.json" },
  { emoji: "🌟", label: "Звезда", animationUrl: "/animations/reactions/star.json" },
  { emoji: "😮", label: "Удивление", animationUrl: "/animations/reactions/wow.json" },
  { emoji: "😢", label: "Грусть", animationUrl: "/animations/reactions/cry.json" },
];

export const REACTION_BY_EMOJI = new Map(REACTIONS.map((r) => [r.emoji, r]));
