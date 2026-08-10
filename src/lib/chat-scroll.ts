import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Chat list scroll: stay pinned to latest only when the user is already near the bottom
 * (or after an explicit pin / conversation switch).
 * Scrolling up to read history must not jump back on poll updates.
 */
export function useStickToBottomScroll(deps: unknown[], conversationKey?: string | null) {
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const forceRef = useRef(true);
  const prevConversationRef = useRef<string | null | undefined>(undefined);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 120;
  }, []);

  const pinToBottom = useCallback(() => {
    forceRef.current = true;
    stickRef.current = true;
  }, []);

  useLayoutEffect(() => {
    if (conversationKey !== undefined && conversationKey !== prevConversationRef.current) {
      prevConversationRef.current = conversationKey;
      forceRef.current = true;
      stickRef.current = true;
    }

    const scrollToBottomIfNeeded = () => {
      const el = listRef.current;
      if (!el) return;
      if (!forceRef.current && !stickRef.current) return;
      el.scrollTop = el.scrollHeight;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < 120) {
        forceRef.current = false;
        stickRef.current = true;
      }
    };

    scrollToBottomIfNeeded();

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(scrollToBottomIfNeeded);
    });
    // ResizablePanel / flex height often settles after paint.
    const t1 = window.setTimeout(scrollToBottomIfNeeded, 50);
    const t2 = window.setTimeout(scrollToBottomIfNeeded, 200);

    const el = listRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && el
        ? new ResizeObserver(() => {
            if (forceRef.current || stickRef.current) scrollToBottomIfNeeded();
          })
        : null;
    if (el && ro) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit deps
  }, [...deps, conversationKey]);

  return { listRef, endRef, onScroll, pinToBottom };
}
