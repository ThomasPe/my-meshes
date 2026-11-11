import { useEffect, useState, type RefObject } from 'react';

/** True once the element has been on screen (or close to it); stays true afterwards. Used to
 * load previews only for what the user actually looks at. */
export function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}
