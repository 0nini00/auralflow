import {
  useCallback,
  useEffect,
  useRef,
  type PointerEventHandler,
  type RefCallback,
  type RefObject,
  type WheelEventHandler,
} from 'react';
import {
  calculateAnchoredLyricScrollTop,
  createLyricAutoScrollController,
  createLyricLineRefRegistry,
  type LyricAutoScrollController,
  type LyricScrollCommand,
} from '@/services/lyrics/autoScrollModel';

interface UseLyricAutoScrollOptions {
  currentLineIndex: number;
  contentKey: string;
  layoutKey: string;
  isPlaying: boolean;
}

interface LyricAutoScrollBindings {
  containerRef: RefObject<HTMLDivElement>;
  setLineRef: (index: number) => RefCallback<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

function easeInOutQuad(progress: number): number {
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

export function useLyricAutoScroll({
  currentLineIndex,
  contentKey,
  layoutKey,
  isPlaying,
}: UseLyricAutoScrollOptions): LyricAutoScrollBindings {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRegistryRef = useRef<ReturnType<typeof createLyricLineRefRegistry<HTMLDivElement>> | null>(null);
  const isPlayingRef = useRef(isPlaying);
  if (!lineRegistryRef.current) {
    lineRegistryRef.current = createLyricLineRefRegistry<HTMLDivElement>();
  }
  isPlayingRef.current = isPlaying;
  const animationFrameRef = useRef<number | null>(null);
  const scrollDriverRef = useRef<(command: LyricScrollCommand) => void>(() => undefined);
  const controllerRef = useRef<LyricAutoScrollController | null>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current == null) return;
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const scrollToIndex = useCallback((command: LyricScrollCommand) => {
    const container = containerRef.current;
    const line = lineRegistryRef.current?.getNode(command.index);
    if (!container || !line) return;

    const targetTop = calculateAnchoredLyricScrollTop({
      clientHeight: container.clientHeight,
      lineOffsetTop: line.offsetTop,
      lineHeight: line.offsetHeight,
      scrollHeight: container.scrollHeight,
    });

    cancelAnimation();
    if (command.durationMs <= 0) {
      container.scrollTop = targetTop;
      return;
    }

    const startTop = container.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) return;

    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / command.durationMs);
      container.scrollTop = startTop + distance * easeInOutQuad(progress);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation]);

  scrollDriverRef.current = scrollToIndex;
  if (!controllerRef.current) {
    controllerRef.current = createLyricAutoScrollController({
      scroll: (command) => scrollDriverRef.current(command),
      canResume: () => isPlayingRef.current,
    });
  }

  const setLineRef = useCallback((index: number): RefCallback<HTMLDivElement> => {
    return lineRegistryRef.current!.getRef(index);
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    cancelAnimation();
    controller.reset();
    const frame = requestAnimationFrame(() => {
      if (currentLineIndex >= 0) controller.setTarget(currentLineIndex);
    });
    return () => cancelAnimationFrame(frame);
  }, [cancelAnimation, contentKey]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (currentLineIndex < 0) {
      controller.reset();
      return;
    }
    controller.setTarget(currentLineIndex);
  }, [currentLineIndex]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => controllerRef.current?.reanchor());
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

  useEffect(() => {
    if (isPlaying) controllerRef.current?.reanchor();
  }, [isPlaying]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => controllerRef.current?.reanchor());
    observer.observe(container);
    return () => observer.disconnect();
  }, [contentKey]);

  useEffect(() => {
    return () => {
      cancelAnimation();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [cancelAnimation]);

  const beginUserScroll = useCallback(() => {
    cancelAnimation();
    controllerRef.current?.beginUserScroll();
  }, [cancelAnimation]);

  const endUserScroll = useCallback(() => {
    controllerRef.current?.endUserScroll();
  }, []);

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>(() => {
    beginUserScroll();
    endUserScroll();
  }, [beginUserScroll, endUserScroll]);

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    beginUserScroll();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: container.scrollTop,
    };
    container.classList.add('af-user-scrolling');
    container.setPointerCapture(event.pointerId);
  }, [beginUserScroll]);

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container || drag.pointerId !== event.pointerId) return;
    container.scrollTop = drag.startScrollTop + drag.startY - event.clientY;
  }, []);

  const finishPointerDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    container?.classList.remove('af-user-scrolling');
    if (container?.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    endUserScroll();
  }, [endUserScroll]);

  const onPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    finishPointerDrag(event.pointerId);
  }, [finishPointerDrag]);

  const onPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    finishPointerDrag(event.pointerId);
  }, [finishPointerDrag]);

  return {
    containerRef,
    setLineRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
