import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";

export const TOP_LAYER_Z_INDEX = 2147483000;

type TopLayerPortalProps = {
  children: ReactNode;
};

type AnchoredPortalProps = {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  side?: "top" | "bottom";
  align?: "left" | "right";
  offset?: number;
  width?: number | "anchor";
  minWidth?: number | "anchor";
  portalRef?: Ref<HTMLDivElement>;
};

export function TopLayerPortal({ children }: TopLayerPortalProps) {
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function AnchoredPortal({
  anchorRef,
  children,
  className,
  style,
  side = "bottom",
  align = "left",
  offset = 8,
  width,
  minWidth,
  portalRef,
}: AnchoredPortalProps) {
  const [positionStyle, setPositionStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const nextStyle: CSSProperties = {
        position: "fixed",
        zIndex: TOP_LAYER_Z_INDEX,
      };

      if (side === "bottom") nextStyle.top = rect.bottom + offset;
      else nextStyle.bottom = window.innerHeight - rect.top + offset;

      if (align === "left") nextStyle.left = rect.left;
      else nextStyle.right = window.innerWidth - rect.right;

      if (width === "anchor") nextStyle.width = rect.width;
      else if (typeof width === "number") nextStyle.width = width;

      if (minWidth === "anchor") nextStyle.minWidth = rect.width;
      else if (typeof minWidth === "number") nextStyle.minWidth = minWidth;

      setPositionStyle(nextStyle);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchorRef, minWidth, offset, side, width]);

  if (!positionStyle) return null;

  return (
    <TopLayerPortal>
      <div ref={portalRef} className={className} style={{ ...positionStyle, ...style }}>
        {children}
      </div>
    </TopLayerPortal>
  );
}
