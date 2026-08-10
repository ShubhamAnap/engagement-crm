import { useCallback, useEffect, useRef } from "react";

/**
 * Chat list scroll: stay pinned to latest only when the user is already near the bottom
 * (or after an explicit pin, e.g. they sent a message / opened the panel).
 * Scrolling up to read history must not jump back on poll / typing updates.
 *
 * Pass `conversationKey` (e.g. thread id) to force-pin when switching conversations.
 */
export function useStickToBottomScroll(deps: unknown[], conversationKey?: string | null) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const forceRef = useRef(false);
  const prevConversationRef = useRef<string | null | undefined>(undefined);

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
      if (distance < 96) {
        forceRef.current = false;
      }
      stickRef.current = distance < 96;
    };

    let raf2 = 0;
    let raf3 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(scrollToBottomIfNeeded);
      });
    });

    const el = listRef.current;
    const ro =
      el && forceRef.current
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
      cancelAnimationFrame(raf3);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit deps
  }, [...deps, conversationKey]);

  return { listRef, onScroll, pinToBottom };
}
