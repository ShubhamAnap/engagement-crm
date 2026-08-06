import { useCallback, useEffect, useRef } from "react";

/**
 * Chat list scroll: stay pinned to latest only when the user is already near the bottom
 * (or after an explicit pin, e.g. they sent a message / opened the panel).
 * Scrolling up to read history must not jump back on poll / typing updates.
 */
export function useStickToBottomScroll(deps: unknown[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const forceRef = useRef(false);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 96;
  }, []);

  const pinToBottom = useCallback(() => {
    forceRef.current = true;
    stickRef.current = true;
  }, []);

  useEffect(() => {
    const scrollToBottomIfNeeded = () => {
      const el = listRef.current;
      if (!el) return;
      if (!forceRef.current && !stickRef.current) return;
      el.scrollTop = el.scrollHeight;
      forceRef.current = false;
      stickRef.current = true;
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(scrollToBottomIfNeeded);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit deps
  }, deps);

  return { listRef, onScroll, pinToBottom };
}
