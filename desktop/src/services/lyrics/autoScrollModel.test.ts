import { describe, expect, it, vi } from 'vitest';
import {
  LYRIC_SCROLL_ANCHOR_RATIO,
  calculateAnchoredLyricScrollTop,
  createLyricAutoScrollController,
  createLyricLineRefRegistry,
} from './autoScrollModel';

describe('calculateAnchoredLyricScrollTop', () => {
  it('anchors the active line at 38% of the viewport', () => {
    expect(calculateAnchoredLyricScrollTop({ clientHeight: 500, lineOffsetTop: 400, lineHeight: 80, scrollHeight: 1200 })).toBe(250);
    expect(LYRIC_SCROLL_ANCHOR_RATIO).toBe(0.38);
  });
  it('clamps the first and last lyric lines', () => {
    expect(calculateAnchoredLyricScrollTop({ clientHeight: 500, lineOffsetTop: 0, lineHeight: 60, scrollHeight: 1200 })).toBe(0);
    expect(calculateAnchoredLyricScrollTop({ clientHeight: 500, lineOffsetTop: 1160, lineHeight: 60, scrollHeight: 1200 })).toBe(700);
  });
});

describe('createLyricAutoScrollController', () => {
  it('delays and animates adjacent forward changes', () => { vi.useFakeTimers(); const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll}); c.setTarget(3); scroll.mockClear(); c.setTarget(4); expect(scroll).not.toHaveBeenCalled(); vi.advanceTimersByTime(599); expect(scroll).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(scroll).toHaveBeenCalledWith({index:4,durationMs:600}); c.dispose(); vi.useRealTimers(); });
  it('immediately repositions seek and non-adjacent jumps', () => { const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll}); c.setTarget(2); c.setTarget(8); c.setTarget(4); expect(scroll).toHaveBeenNthCalledWith(1,{index:2,durationMs:0}); expect(scroll).toHaveBeenNthCalledWith(2,{index:8,durationMs:0}); expect(scroll).toHaveBeenNthCalledWith(3,{index:4,durationMs:0}); });
  it('resumes latest line after three seconds of manual scrolling', () => { vi.useFakeTimers(); const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll}); c.setTarget(5); scroll.mockClear(); c.beginUserScroll(); c.setTarget(6); c.setTarget(7); c.endUserScroll(); vi.advanceTimersByTime(2999); expect(scroll).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(scroll).toHaveBeenCalledWith({index:7,durationMs:0}); c.dispose(); vi.useRealTimers(); });
  it('does not snap back after manual scrolling while playback is paused', () => { vi.useFakeTimers(); let isPlaying=false; const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll, canResume:()=>isPlaying}); c.setTarget(5); scroll.mockClear(); c.beginUserScroll(); c.setTarget(6); c.endUserScroll(); vi.advanceTimersByTime(3000); expect(scroll).not.toHaveBeenCalled(); isPlaying=true; c.reanchor(); expect(scroll).toHaveBeenCalledWith({index:6,durationMs:0}); c.dispose(); vi.useRealTimers(); });
  it('reanchors latest line after layout changes', () => { const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll}); c.setTarget(5); scroll.mockClear(); c.reanchor(); expect(scroll).toHaveBeenCalledWith({index:5,durationMs:0}); });
  it('clears a stale target when lyrics are replaced', () => { const scroll=vi.fn(); const c=createLyricAutoScrollController({scroll}); c.setTarget(5); scroll.mockClear(); c.reset(); c.reanchor(); expect(scroll).not.toHaveBeenCalled(); });
});

describe('createLyricLineRefRegistry', () => {
  it('keeps callback refs stable while updating the indexed node', () => {
    const registry = createLyricLineRefRegistry<HTMLDivElement>();
    const firstRef = registry.getRef(2);
    expect(registry.getRef(2)).toBe(firstRef);

    const node = {} as HTMLDivElement;
    firstRef(node);
    expect(registry.getNode(2)).toBe(node);

    firstRef(null);
    expect(registry.getNode(2)).toBeUndefined();
  });
});
