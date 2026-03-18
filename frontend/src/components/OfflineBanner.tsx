import { useNetworkStore } from "../store/network";

/**
 * Thin banner shown at the top of the screen when the user is offline.
 * Renders nothing when online.
 */
export function OfflineBanner() {
  const isOnline = useNetworkStore((s) => s.isOnline);

  if (isOnline) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500 text-white text-xs font-medium px-3 py-1.5 select-none z-50">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <line x1="2" x2="22" y1="2" y2="22" />
        <path d="M8.5 16.5a5 5 0 0 1 7 0" />
        <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
        <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
        <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
        <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
        <line x1="12" x2="12.01" y1="20" y2="20" />
      </svg>
      <span>Нет подключения. Сообщения будут отправлены при восстановлении связи.</span>
    </div>
  );
}
