import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Tracks which page placements should target.
 *
 * Scroll visibility normally drives the active page, but clicking a
 * thumbnail "pins" the target immediately so placements land there before
 * the smooth scroll arrives. The pin releases once the pinned page becomes
 * the most visible page, or as soon as the user scrolls manually.
 */
export function useActivePage(scrollRootRef: RefObject<HTMLDivElement>, docKey: string | null) {
  const [visibility, setVisibility] = useState<Record<number, number>>({ 0: 1 });
  const [pinnedPage, setPinnedPage] = useState<number | null>(null);
  const pageElementsRef = useRef<Record<number, HTMLDivElement | null>>({});

  const visiblePage = useMemo(() => {
    const entries = Object.entries(visibility);
    if (entries.length === 0) return 0;
    return Number(entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0);
  }, [visibility]);

  const activePage = pinnedPage ?? visiblePage;

  useEffect(() => {
    setVisibility({ 0: 1 });
    setPinnedPage(null);
  }, [docKey]);

  useEffect(() => {
    if (pinnedPage !== null && visiblePage === pinnedPage) {
      setPinnedPage(null);
    }
  }, [pinnedPage, visiblePage]);

  // Re-attach when docKey changes: the scroll root may not exist yet on a
  // mount that happens before any document is selected.
  useEffect(() => {
    const element = scrollRootRef.current;
    if (!element) return;

    const clearPin = () => setPinnedPage(null);
    element.addEventListener('wheel', clearPin, { passive: true });
    element.addEventListener('touchmove', clearPin, { passive: true });
    return () => {
      element.removeEventListener('wheel', clearPin);
      element.removeEventListener('touchmove', clearPin);
    };
  }, [scrollRootRef, docKey]);

  const onVisibilityChange = useCallback((pageIndex: number, ratio: number) => {
    setVisibility((current) => ({ ...current, [pageIndex]: ratio }));
  }, []);

  const onPageElement = useCallback((pageIndex: number, element: HTMLDivElement | null) => {
    pageElementsRef.current[pageIndex] = element;
  }, []);

  const selectPage = useCallback((pageIndex: number) => {
    setPinnedPage(pageIndex);
    pageElementsRef.current[pageIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return { activePage, onVisibilityChange, onPageElement, selectPage };
}
