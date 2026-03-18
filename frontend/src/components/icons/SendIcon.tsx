/** Paper airplane (send) icon — wider strokes, rounded corners. Use for all send actions. */
export default function SendIcon({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Paper plane: tip top-right, tail bottom-left; thick rounded outline */}
      <path d="M22 2 L11 13 L2 9 L22 2 L18 22 L11 13 L2 9" />
    </svg>
  );
}
