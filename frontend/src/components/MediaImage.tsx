import { useEffect, useRef, useState } from "react";
import { useMediaAccess } from "../hooks/useMediaAccess";

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string | null | undefined;
  lazy?: boolean;
}

export function MediaImage({ source, lazy = true, alt = "", ...props }: MediaImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(!lazy);
  const resolvedUrl = useMediaAccess(source, { enabled: visible });

  useEffect(() => {
    if (!lazy) {
      setVisible(true);
      return;
    }
    const node = imgRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, source]);

  return <img ref={imgRef} src={resolvedUrl || TRANSPARENT_PIXEL} alt={alt} {...props} />;
}
