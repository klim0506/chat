/**
 * Allowed chat/channel reaction emojis — must match backend `REACTION_EMOJIS`
 * (`apps/chats/models.py`). Otherwise POST …/reactions/ returns 400.
 */
export interface ReactionDef {
  emoji: string;
  label: string;
  animationUrl?: string;
}

export const REACTIONS: ReactionDef[] = [
  { emoji: "\u{1F525}", label: "Огонёк", animationUrl: "/animations/reactions/fire.json" },
  { emoji: "\u{1F4AB}", label: "Звёзды" },
  { emoji: "\u2728", label: "Блеск" },
  { emoji: "\u2764\uFE0F", label: "Сердце" },
  { emoji: "\u{1F970}", label: "Нежность" },
  { emoji: "\u{1F602}", label: "Смех" },
  { emoji: "\u{1F60E}", label: "Круто" },
  { emoji: "\u{1F389}", label: "Праздник" },
  { emoji: "\u{1F64C}", label: "Ура" },
  { emoji: "\u{1F44F}", label: "Аплодисменты" },
  { emoji: "\u{1F4AA}", label: "Сила" },
  { emoji: "\u{1F929}", label: "Восторг" },
  { emoji: "\u{1F31F}", label: "Звезда" },
  { emoji: "\u{1F62E}", label: "Удивление" },
  { emoji: "\u{1F622}", label: "Грусть" },
];

export const REACTION_BY_EMOJI = new Map(REACTIONS.map((r) => [r.emoji, r]));
