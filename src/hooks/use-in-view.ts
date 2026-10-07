import { useCallback, useEffect, useState } from "react";

/** Fork: whether an element is on screen now. For motion that only means
 * something when seen — a loading pulse below the fold must not keep the
 * window composing (lib/frame-budget). Without IntersectionObserver it says
 * true, so nothing goes still that should move. */
export function useInView<T extends Element>(): [(element: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [useCallback((next: T | null) => setElement(next), []), inView];
}
