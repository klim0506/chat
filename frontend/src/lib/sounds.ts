import { usePreferencesStore } from "../store/preferences";

export type SoundType = "send" | "receive" | "mention";

const SOUND_PATHS: Record<SoundType, string> = {
  send: "/sounds/send.mp3",
  receive: "/sounds/receive.mp3",
  mention: "/sounds/mention.mp3",
};

/** Debounce delay (ms) to avoid overlapping rapid sounds of the same type */
const DEBOUNCE_MS = 200;

let lastPlayed: Record<SoundType, number> = {
  send: 0,
  receive: 0,
  mention: 0,
};

const audioCache: Record<SoundType, HTMLAudioElement | null> = {
  send: null,
  receive: null,
  mention: null,
};

function shouldPlaySound(type: SoundType): boolean {
  const prefs = usePreferencesStore.getState();
  if (!prefs.soundEnabled) return false;
  switch (type) {
    case "send":
      return prefs.soundSend;
    case "receive":
      return prefs.soundReceive;
    case "mention":
      return prefs.soundMention;
    default:
      return false;
  }
}

function createFallbackTone(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  type: OscillatorType = "sine"
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

function playFallback(type: SoundType): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();

    switch (type) {
      case "send":
        createFallbackTone(ctx, 880, 0.05, "sine");
        break;
      case "receive":
        createFallbackTone(ctx, 660, 0.06, "sine");
        break;
      case "mention":
        createFallbackTone(ctx, 880, 0.04, "sine");
        createFallbackTone(ctx, 1100, 0.06, "sine");
        break;
    }
  } catch {
    // Ignore audio errors (e.g. autoplay blocked)
  }
}

function playFromFile(type: SoundType): void {
  let audio = audioCache[type];
  if (!audio) {
    audio = new Audio(SOUND_PATHS[type]);
    audioCache[type] = audio;
  }

  audio.currentTime = 0;
  audio.volume = 0.5;
  const p = audio.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {
      playFallback(type);
    });
  }
}

/**
 * Play a notification sound. Respects user preferences and debounces rapid consecutive plays.
 */
export function playSound(type: SoundType): void {
  if (!shouldPlaySound(type)) return;

  const now = Date.now();
  if (now - lastPlayed[type] < DEBOUNCE_MS) return;
  lastPlayed[type] = now;

  if (audioCache[type]) {
    playFromFile(type);
    return;
  }

  const audio = new Audio(SOUND_PATHS[type]);
  audioCache[type] = audio;

  audio.addEventListener(
    "error",
    () => {
      audioCache[type] = null;
      playFallback(type);
    },
    { once: true }
  );

  audio.addEventListener(
    "canplaythrough",
    () => {
      playFromFile(type);
    },
    { once: true }
  );

  audio.load();
}
