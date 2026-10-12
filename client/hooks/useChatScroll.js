/**
 * useChatScroll Hook
 * Release 3.2.3 - Viewport Bottom-Pinning & Pagination Scroll Management
 */

import { useEffect, useRef, useCallback } from 'react';

export function useChatScroll(dependency) {
  const scrollRef = useRef(null);
  const isNearBottomRef = useRef(true);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 150; // px from bottom
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom <= threshold;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, []);

  // Track user scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      checkIfNearBottom();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [checkIfNearBottom]);

  // Pin to bottom whenever dependencies change (new messages arrive)
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom(false);
    }
  }, [dependency, scrollToBottom]);

  return {
    scrollRef,
    scrollToBottom
  };
}

export default useChatScroll;
