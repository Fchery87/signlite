import { useEffect, useState } from 'react';

/** Matches Tailwind's `lg` breakpoint: from here the editor keeps its side panels
 *  docked and fits the whole workspace inside the viewport. */
export const WIDE_LAYOUT_QUERY = '(min-width: 1024px)';

export function useWideLayout() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia(WIDE_LAYOUT_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}
