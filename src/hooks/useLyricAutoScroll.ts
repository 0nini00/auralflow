import { useCallback, useEffect, useLayoutEffect, useRef, type WheelEvent } from "react";

interface UseLyricAutoScrollOptions {
  active?: boolean;
  currentLine: number;
  progress: number;
  resetKey?: string | number | null;
}

const SEEK_JUMP_SECONDS = 2;
const USER_SCROLL_RESUME_DELAY = 3000;
const ACTIVE_LINE_SETTLE_INTERVAL = 80;
const ACTIVE_LINE_SETTLE_ATTEMPTS = 6;
const CENTER_TOLERANCE_PX = 1;

function getCenteredScrollTop(container: HTMLDivElement, lineEl: HTMLDivElement): number {
  const containerRect = container.getBoundingClientRect();
  const lineRect = lineEl.getBoundingClientRect();
  const lineCenterFromContainerTop = lineRect.top - containerRect.top + lineRect.height / 2;
  return Math.max(0, container.scrollTop + lineCenterFromContainerTop - container.clientHeight / 2);
}

export function useLyricAutoScroll({
  active = true,
  currentLine,
  progress,
  resetKey,
}: UseLyricAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevLineRef = useRef(-1);
  const prevProgressRef = useRef(progress);
  const currentLineRef = useRef(currentLine);
  const animFrameRef = useRef<number | null>(null);
  const centerCorrectionTimeoutRef = useRef<number | null>(null);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const isUserScrollingRef = useRef(false);

  const cancelScheduledScroll = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (centerCorrectionTimeoutRef.current != null) {
      window.clearTimeout(centerCorrectionTimeoutRef.current);
      centerCorrectionTimeoutRef.current = null;
    }
  }, []);

  const clearUserScrollTimer = useCallback(() => {
    if (userScrollTimeoutRef.current == null) return;
    window.clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const updateCenterPadding = () => {
      container.style.setProperty("--af-lyrics-center-padding", `${container.clientHeight / 2}px`);
    };

    updateCenterPadding();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateCenterPadding);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, resetKey]);

  const centerLineNow = useCallback((line: number, behavior: ScrollBehavior = "auto") => {
    const container = containerRef.current;
    const lineEl = lineRefs.current[line];
    if (!container || !lineEl) return false;

    const targetTop = getCenteredScrollTop(container, lineEl);
    const delta = Math.abs(container.scrollTop - targetTop);
    if (delta <= CENTER_TOLERANCE_PX) return true;

    container.scrollTo({ top: targetTop, behavior });
    return false;
  }, []);

  const scheduleCenterSettling = useCallback((line: number) => {
    let attempts = 0;

    const settle = () => {
      centerCorrectionTimeoutRef.current = null;
      if (isUserScrollingRef.current) return;

      const isCentered = centerLineNow(line, "auto");
      attempts += 1;
      if (isCentered || attempts >= ACTIVE_LINE_SETTLE_ATTEMPTS) return;

      centerCorrectionTimeoutRef.current = window.setTimeout(settle, ACTIVE_LINE_SETTLE_INTERVAL);
    };

    centerCorrectionTimeoutRef.current = window.setTimeout(settle, ACTIVE_LINE_SETTLE_INTERVAL);
  }, [centerLineNow]);

  const scrollToLine = useCallback((line: number, behavior: ScrollBehavior = "smooth") => {
    if (line < 0) return;

    cancelScheduledScroll();
    animFrameRef.current = requestAnimationFrame(() => {
      centerLineNow(line, behavior);
      animFrameRef.current = null;
      scheduleCenterSettling(line);
    });
  }, [cancelScheduledScroll, centerLineNow, scheduleCenterSettling]);

  const resumeAutoScroll = useCallback((shouldScroll = true) => {
    clearUserScrollTimer();
    isUserScrollingRef.current = false;
    prevLineRef.current = -1;
    if (shouldScroll) scrollToLine(currentLineRef.current);
  }, [clearUserScrollTimer, scrollToLine]);

  const pauseAutoScroll = useCallback(() => {
    isUserScrollingRef.current = true;
    cancelScheduledScroll();
    clearUserScrollTimer();
    userScrollTimeoutRef.current = window.setTimeout(() => {
      resumeAutoScroll(true);
    }, USER_SCROLL_RESUME_DELAY);
  }, [cancelScheduledScroll, clearUserScrollTimer, resumeAutoScroll]);

  const setLineRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    lineRefs.current[index] = el;
  }, []);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current ?? event.currentTarget;
    if (!container || event.deltaY === 0) return;

    pauseAutoScroll();
    event.preventDefault();
    container.scrollTop += event.deltaY;
  }, [pauseAutoScroll]);

  useEffect(() => {
    currentLineRef.current = currentLine;
  }, [currentLine]);

  useEffect(() => {
    const delta = Math.abs(progress - prevProgressRef.current);
    if (delta > SEEK_JUMP_SECONDS) {
      resumeAutoScroll(false);
    }
    prevProgressRef.current = progress;
  }, [progress, resumeAutoScroll]);

  useEffect(() => {
    resumeAutoScroll(false);
    lineRefs.current = [];
    const container = containerRef.current;
    if (container) container.scrollTop = 0;
  }, [resetKey, resumeAutoScroll]);

  useEffect(() => {
    if (!active) return;
    if (isUserScrollingRef.current) return;
    if (currentLine < 0 || currentLine === prevLineRef.current) return;

    prevLineRef.current = currentLine;
    scrollToLine(currentLine);

    return cancelScheduledScroll;
  }, [active, currentLine, cancelScheduledScroll, scrollToLine]);

  useEffect(() => {
    return () => {
      cancelScheduledScroll();
      clearUserScrollTimer();
    };
  }, [cancelScheduledScroll, clearUserScrollTimer]);

  return {
    containerRef,
    handleWheel,
    resumeAutoScroll,
    setLineRef,
  };
}
