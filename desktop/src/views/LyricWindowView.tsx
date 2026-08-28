/**
 * 桌面歌词独立窗口的视图。
 * 透明背景 + 居中两行歌词 + 简易 mini 控件。
 * 状态来自 playerSync 接收主窗口广播；按钮通过 dispatchLyricAction 反向。
 */

import { usePlayerStore } from "@/stores/playerStore";
import { useLyrics } from "@/hooks/useLyrics";
import { useInterpolatedPlaybackProgress } from "@/hooks/useInterpolatedPlaybackProgress";
import {
  getLyricAnimationIntensityScale,
  normalizeLyricAnimationIntensity,
  type LyricAnimationIntensity,
} from "@/services/lyrics/animationIntensity";
import { dispatchLyricAction } from "@/stores/playerSync";
import { subscribeLyricSettings, broadcastLyricSettings } from "@/stores/lyricSettingsSync";
import { buildDesktopLyricLines, type DesktopLyricDisplayLine } from "@/utils/desktopLyric";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getLyricWindowState, loadSettings, patchSettings, prepareLyricWindowLock, setLyricWindowPinned, setLyricWindowLocked, toggleLyricWindow } from "@lx/tauri-bridge";
import { Play, Pause, SkipBack, SkipForward, X, Pin, PinOff, Plus, Minus, Lock, Unlock } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useState, memo } from "react";

export function LyricWindowView() {
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.progress);
  const progressSampledAt = usePlayerStore((s) => s.progressSampledAt);
  const duration = usePlayerStore((s) => s.duration);
  const playbackRate = usePlayerStore((s) => s.playbackRate);

  const lyricProgress = useInterpolatedPlaybackProgress({ status, progress, progressSampledAt, duration, playbackRate });
  const [manualOffsetMs, setManualOffsetMs] = useState(0);
  const { lyrics, currentLine } = useLyrics(current, lyricProgress, manualOffsetMs / 1000);
  const isPlaying = status === "playing";

  // 持久化：置顶状态 + 字号
  const [pinned, setPinned] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pauseHide, setPauseHide] = useState(false);
  const [fontSize, setFontSize] = useState(28);
  const [showNextLine, setShowNextLine] = useState(true);
  const [singleLine, setSingleLine] = useState(false);
  const [maxLineNum, setMaxLineNum] = useState(2);
  const [showTranslation, setShowTranslation] = useState(true);
  const [align, setAlign] = useState("center");
  const [lineGap, setLineGap] = useState(8);
  const [fontWeight, setFontWeight] = useState(700);
  const [activeColor, setActiveColor] = useState("#ffffff");
  const [nextColor, setNextColor] = useState("#d1d5db");
  const [shadowColor, setShadowColor] = useState("#000000");
  const [textOpacity, setTextOpacity] = useState(0.95);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.55);
  const [textPositionX, setTextPositionX] = useState(0);
  const [textPositionY, setTextPositionY] = useState(0);
  const [hoverHide, setHoverHide] = useState(false);
  const [enableAnimation, setEnableAnimation] = useState(true);
  const [animationIntensity, setAnimationIntensity] = useState<LyricAnimationIntensity>("normal");
  const [cursorHover, setCursorHover] = useState(false);

  useEffect(() => {
    let disposed = false;
    void loadSettings()
      .then(async (s) => {
        if (disposed) return;
        setPinned(s.lyricPinned);
        setPauseHide(s.lyricPauseHide);
        if (s.lyricFontSize && s.lyricFontSize > 0) setFontSize(s.lyricFontSize);
        setShowNextLine(s.lyricShowNextLine);
        setSingleLine(s.lyricSingleLine);
        setMaxLineNum(s.lyricMaxLineNum || 2);
        setShowTranslation(s.lyricShowTranslation);
        setAlign(s.lyricAlign || "center");
        setLineGap(s.lyricLineGap ?? 8);
        setFontWeight(s.lyricFontWeight ?? 700);
        setActiveColor(s.lyricActiveColor || "#ffffff");
        setNextColor(s.lyricNextColor || "#d1d5db");
        setShadowColor(s.lyricShadowColor || "#000000");
        setTextOpacity(typeof s.lyricTextOpacity === "number" ? s.lyricTextOpacity : 0.95);
        setBackgroundOpacity(typeof s.lyricBackgroundOpacity === "number" ? s.lyricBackgroundOpacity : 0.55);
        setTextPositionX(typeof s.lyricTextPositionX === "number" ? s.lyricTextPositionX : 0);
        setTextPositionY(typeof s.lyricTextPositionY === "number" ? s.lyricTextPositionY : 0);
        setHoverHide(s.lyricHoverHide);
        setEnableAnimation(s.lyricEnableAnimation);
        setAnimationIntensity(normalizeLyricAnimationIntensity(s.lyricAnimationIntensity));
        setManualOffsetMs(typeof s.lyricManualOffsetMs === "number" ? s.lyricManualOffsetMs : 0);
        try {
          const runtimeState = await getLyricWindowState();
          if (!disposed) setLocked(runtimeState.locked);
        } catch {
          // Keep the default unlocked UI rather than trusting stale persisted lock state.
        }
      })
      .catch(() => undefined);

    const unsubscribeLyricSettings = subscribeLyricSettings((patch) => {
      if (disposed) return;
      if (typeof patch.lyricPinned === "boolean") setPinned(patch.lyricPinned);
      if (typeof patch.lyricLocked === "boolean") setLocked(patch.lyricLocked);
      if (typeof patch.lyricPauseHide === "boolean") setPauseHide(patch.lyricPauseHide);
      if (typeof patch.lyricFontSize === "number" && patch.lyricFontSize > 0) {
        setFontSize(patch.lyricFontSize);
      }
      if (typeof patch.lyricShowNextLine === "boolean") setShowNextLine(patch.lyricShowNextLine);
      if (typeof patch.lyricSingleLine === "boolean") setSingleLine(patch.lyricSingleLine);
      if (typeof patch.lyricMaxLineNum === "number") setMaxLineNum(patch.lyricMaxLineNum);
      if (typeof patch.lyricShowTranslation === "boolean") setShowTranslation(patch.lyricShowTranslation);
      if (typeof patch.lyricAlign === "string") setAlign(patch.lyricAlign);
      if (typeof patch.lyricLineGap === "number") setLineGap(patch.lyricLineGap);
      if (typeof patch.lyricFontWeight === "number") setFontWeight(patch.lyricFontWeight);
      if (typeof patch.lyricActiveColor === "string") setActiveColor(patch.lyricActiveColor);
      if (typeof patch.lyricNextColor === "string") setNextColor(patch.lyricNextColor);
      if (typeof patch.lyricShadowColor === "string") setShadowColor(patch.lyricShadowColor);
      if (typeof patch.lyricTextOpacity === "number") setTextOpacity(patch.lyricTextOpacity);
      if (typeof patch.lyricBackgroundOpacity === "number") setBackgroundOpacity(patch.lyricBackgroundOpacity);
      if (typeof patch.lyricTextPositionX === "number") setTextPositionX(patch.lyricTextPositionX);
      if (typeof patch.lyricTextPositionY === "number") setTextPositionY(patch.lyricTextPositionY);
      if (typeof patch.lyricHoverHide === "boolean") setHoverHide(patch.lyricHoverHide);
      if (typeof patch.lyricEnableAnimation === "boolean") setEnableAnimation(patch.lyricEnableAnimation);
      if (typeof patch.lyricAnimationIntensity === "string") {
        setAnimationIntensity(normalizeLyricAnimationIntensity(patch.lyricAnimationIntensity));
      }
      if (typeof patch.lyricManualOffsetMs === "number") setManualOffsetMs(patch.lyricManualOffsetMs);
    });
    return () => {
      disposed = true;
      unsubscribeLyricSettings();
    };
  }, []);

  const displayLines = buildDesktopLyricLines({
    lines: lyrics,
    currentLine,
    hasCurrentMusic: Boolean(current),
    showNextLine,
    singleLine,
    maxLineNum,
    showTranslation,
    currentTime: lyricProgress,
  });

  useEffect(() => {
    const window = getCurrentWindow();
    if (pauseHide && current && status === "paused") {
      void window.hide().catch(() => undefined);
    } else {
      void window.show().catch(() => undefined);
    }
  }, [current, pauseHide, status]);

  // 锁定态下 Rust 侧 emit 光标进出事件，用于悬浮解锁条的显隐
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      listen("lyric-cursor-enter", () => setCursorHover(true)),
      listen("lyric-cursor-leave", () => setCursorHover(false)),
    ]).then((fns) => {
      if (disposed) {
        fns.forEach((fn) => fn());
        return;
      }
      unlisteners.push(...fns);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const handleClose = () => {
    void toggleLyricWindow().catch(() => undefined);
  };

  const togglePinned = async () => {
    const next = !pinned;
    setPinned(next);
    try {
      await setLyricWindowPinned(next);
      broadcastLyricSettings({ lyricPinned: next });
    } catch {
      setPinned(!next); // 回滚
    }
  };

  const toggleLocked = async () => {
    const next = !locked;
    try {
      const lockEpoch = next ? await prepareLyricWindowLock() : undefined;
      const applied = await setLyricWindowLocked(next, lockEpoch, "lyric-window");
      if (!applied) return;
      setLocked(next);
      broadcastLyricSettings({ lyricLocked: next });
    } catch {
      setLocked(locked);
      broadcastLyricSettings({ lyricLocked: locked });
    }
  };

  const adjustFontSize = (delta: number) => {
    const next = Math.max(16, Math.min(52, fontSize + delta));
    setFontSize(next);
    broadcastLyricSettings({ lyricFontSize: next });
    void patchSettings({ lyricFontSize: next }).catch(() => undefined);
  };

  const startWindowDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  const animationScale = getLyricAnimationIntensityScale(animationIntensity);

  return (
    <div
      className={`af-lyric-shell ${hoverHide ? "af-lyric-hover-hide" : ""} ${locked ? "af-lyric-locked" : ""}`}
      style={{
        "--af-lyric-panel-opacity": Math.min(backgroundOpacity, 0.28),
        "--af-lyric-animation-intensity": animationScale,
        "--af-lyric-fade-offset": `${6 * animationScale}px`,
      } as CSSProperties}
      onMouseDown={startWindowDrag}
    >
      {/* 歌词区 + 工具栏：歌词在前，工具栏紧跟其后 */}
      <div
        className="af-lyric-stage"
        style={{
          gap: `${lineGap}px`,
          opacity: textOpacity,
          transform: `translate(${textPositionX}%, ${textPositionY}%)`,
        }}
      >
        {displayLines.map((line) =>
          line.role === "current" && line.words?.length ? (
            <KaraokeLine
              key={line.key}
              line={line}
              progress={lyricProgress + manualOffsetMs / 1000}
              align={align}
              activeColor={activeColor}
              enableAnimation={enableAnimation}
              fontSize={fontSize}
              fontWeight={fontWeight}
              shadowColor={shadowColor}
            />
          ) : (
            <LyricLineText
              key={line.key}
              line={line}
              align={align}
              activeColor={activeColor}
              nextColor={nextColor}
              enableAnimation={enableAnimation}
              fontSize={fontSize}
              fontWeight={fontWeight}
              shadowColor={shadowColor}
            />
          )
        )}
        {/* 工具栏：紧跟歌词下方，流式排列 */}
        <div className="af-lyric-drag-band">
          <div className="af-lyric-drag" data-tauri-drag-region>
            <div className="af-lyric-tools">
              <button
                type="button"
                className="af-lyric-tool"
                onClick={() => dispatchLyricAction("prev")}
                title="上一首"
              >
                <SkipBack size={14} />
              </button>
              <button
                type="button"
                className="af-lyric-tool af-lyric-tool-primary"
                onClick={() => dispatchLyricAction("play-pause")}
                title={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </button>
              <button
                type="button"
                className="af-lyric-tool"
                onClick={() => dispatchLyricAction("next")}
                title="下一首"
              >
                <SkipForward size={14} />
              </button>
            </div>

            <div className="af-lyric-tools">
              <button
                type="button"
                className="af-lyric-tool"
                onClick={() => adjustFontSize(-2)}
                title="减小字号"
                disabled={fontSize <= 16}
              >
                <Minus size={12} />
              </button>
              <button
                type="button"
                className="af-lyric-tool"
                onClick={() => adjustFontSize(2)}
                title="增大字号"
                disabled={fontSize >= 52}
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                className={`af-lyric-tool ${pinned ? "af-lyric-tool-active" : ""}`}
                onClick={togglePinned}
                title={pinned ? "取消始终显示在其他窗口上方" : "始终显示在其他窗口上方"}
              >
                {pinned ? <Pin size={12} /> : <PinOff size={12} />}
              </button>
              <button
                type="button"
                className={`af-lyric-tool ${locked ? "af-lyric-tool-active" : ""}`}
                onClick={toggleLocked}
                title={locked ? "解锁窗口" : "锁定窗口"}
              >
                {locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                type="button"
                className="af-lyric-tool af-lyric-tool-danger"
                onClick={handleClose}
                title="关闭桌面歌词"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 锁定态光标悬停时的悬浮解锁条 */}
      {locked && (
        <div className={`af-lyric-tools af-lyric-unlock-bar ${cursorHover ? "af-lyric-unlock-bar-visible" : ""}`}>
          <button
            type="button"
            className="af-lyric-tool"
            onClick={toggleLocked}
            title="解锁窗口"
          >
            <Unlock size={16} />
          </button>
          <button
            type="button"
            className="af-lyric-tool af-lyric-tool-danger"
            onClick={handleClose}
            title="关闭桌面歌词"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <style>{`
        html, body, #root {
          background: transparent !important;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
        .af-lyric-shell {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          background: transparent;
          color: #fff;
          font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          user-select: none;
          cursor: grab;
        }
        .af-lyric-shell:active {
          cursor: grabbing;
        }
        .af-lyric-shell.af-lyric-locked,
        .af-lyric-shell.af-lyric-locked:active {
          cursor: default;
        }
        .af-lyric-shell:hover .af-lyric-drag-band {
          opacity: 1;
        }
        .af-lyric-shell.af-lyric-hover-hide:hover {
          opacity: 0.08;
        }
        .af-lyric-locked .af-lyric-drag-band {
          display: none;
        }
        /* 工具栏：紧跟歌词下方，流式排列不脱离文档流 */
        .af-lyric-drag-band {
          z-index: 2;
          opacity: 0;
          transition: opacity 0.2s;
          pointer-events: none;
          align-self: center;
          margin-top: 0;
        }
        .af-lyric-shell:hover .af-lyric-drag-band {
          opacity: 1;
        }
        .af-lyric-drag {
          pointer-events: auto;
          width: fit-content;
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 3px 6px;
          background: rgba(10, 12, 16, var(--af-lyric-panel-opacity, 0.24));
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          backdrop-filter: blur(16px) saturate(120%);
          -webkit-backdrop-filter: blur(16px) saturate(120%);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.16);
          cursor: grab;
        }
        .af-lyric-drag:active {
          cursor: grabbing;
        }
        .af-lyric-tools {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .af-lyric-tool {
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.85);
          border-radius: 7px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .af-lyric-tool:hover:not(:disabled) {
          background: rgba(255,255,255,0.18);
          color: #fff;
        }
        .af-lyric-tool:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .af-lyric-tool-active {
          background: rgba(var(--af-accent-primary-rgb), 0.6);
          color: #fff;
        }
        .af-lyric-tool-active:hover {
          background: rgba(var(--af-accent-primary-rgb), 0.85);
        }
        .af-lyric-tool-primary {
          width: 26px;
          height: 26px;
          background: rgba(var(--af-accent-primary-rgb), 0.85);
          color: #fff;
        }
        .af-lyric-tool-primary:hover {
          background: rgba(var(--af-accent-primary-rgb), 1);
        }
        .af-lyric-tool-danger:hover {
          background: rgba(239, 68, 68, 0.85);
          color: #fff;
        }
        .af-lyric-meta {
          display: none;
        }
        .af-lyric-stage {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 2px;
          min-height: 0;
          padding: 2px 8px;
          pointer-events: none;
        }
        .af-lyric-line {
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0;
        }
        .af-lyric-line-main {
          display: inline-block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          vertical-align: top;
          /* 避免渐变进度在 clip 失败时铺成整条色块框 */
          background-color: transparent;
        }
        .af-lyric-line-now .af-lyric-line-main {
          color: transparent;
          -webkit-text-fill-color: transparent;
          background-color: transparent;
          background-image: linear-gradient(
            90deg,
            var(--af-lyric-active-color) 0%,
            var(--af-lyric-active-color) var(--af-lyric-line-progress),
            rgba(255, 255, 255, 0.48) var(--af-lyric-line-progress),
            rgba(255, 255, 255, 0.48) 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
        }
        /* 逐字卡拉OK：当前词用自身渐变，行级渐变关闭以免叠加串色 */
        .af-lyric-line-now .af-lyric-line-main.af-lyric-karaoke {
          background-image: none;
        }
        .af-lyric-karaoke-word {
          color: rgba(255, 255, 255, 0.48);
          /* 覆盖行级 -webkit-text-fill-color: transparent 的继承，否则未唱词不可见 */
          -webkit-text-fill-color: rgba(255, 255, 255, 0.48);
        }
        .af-lyric-karaoke-word-sung {
          color: var(--af-lyric-active-color);
          background: none;
          -webkit-text-fill-color: var(--af-lyric-active-color);
        }
        .af-lyric-karaoke-word-active {
          color: transparent;
          -webkit-text-fill-color: transparent;
          background-color: transparent;
          background-image: linear-gradient(
            90deg,
            var(--af-lyric-active-color) 0%,
            var(--af-lyric-active-color) var(--af-lyric-word-progress),
            rgba(255, 255, 255, 0.48) var(--af-lyric-word-progress),
            rgba(255, 255, 255, 0.48) 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
        }
        .af-lyric-line-now.af-lyric-line-animated {
          animation: af-lyric-fade 0.35s ease-out;
        }
        .af-lyric-line-next {
          min-height: 22px;
        }
        .af-lyric-line-empty {
          color: rgba(255,255,255,0.78);
        }
        .af-lyric-line-translation {
          display: block;
          margin-top: 4px;
          font-size: 0.52em;
          font-weight: 500;
          opacity: 0.72;
        }
        .af-lyric-unlock-bar {
          position: absolute;
          top: 6px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 3;
          padding: 5px 10px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          background: rgba(10, 12, 16, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          backdrop-filter: blur(16px) saturate(120%);
          -webkit-backdrop-filter: blur(16px) saturate(120%);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.16);
        }
        .af-lyric-unlock-bar-visible {
          opacity: 1;
          pointer-events: auto;
        }
        @keyframes af-lyric-fade {
          from { opacity: 0; transform: translateY(var(--af-lyric-fade-offset, 6px)); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .af-lyric-line-now.af-lyric-line-animated {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

interface LyricLineTextProps {
  line: DesktopLyricDisplayLine;
  align: string;
  activeColor: string;
  nextColor: string;
  enableAnimation: boolean;
  fontSize: number;
  fontWeight: number;
  shadowColor: string;
}

function LyricLineText({
  line,
  align,
  activeColor,
  nextColor,
  enableAnimation,
  fontSize,
  fontWeight,
  shadowColor,
}: LyricLineTextProps) {
  const isCurrent = line.role === "current";
  const isEmpty = line.role === "empty";
  const size = isCurrent || isEmpty ? fontSize : Math.round(fontSize * 0.62);
  // 轻阴影即可；重描边/重光晕会让当前行看起来像套了框
  const textShadow = isCurrent
    ? `0 1px 8px ${shadowColor}`
    : `0 1px 4px ${shadowColor}`;
  const lineProgress = `${Math.round((line.progress ?? 0) * 1000) / 10}%`;

  return (
    <div
      className={[
        "af-lyric-line",
        isCurrent ? "af-lyric-line-now" : "af-lyric-line-next",
        isEmpty ? "af-lyric-line-empty" : "",
        enableAnimation && isCurrent ? "af-lyric-line-animated" : "",
      ].filter(Boolean).join(" ")}
      style={{
        "--af-lyric-active-color": activeColor,
        "--af-lyric-line-progress": lineProgress,
        color: isCurrent ? activeColor : nextColor,
        fontSize: `${size}px`,
        fontWeight: isCurrent ? fontWeight : 500,
        textAlign: align as "left" | "center" | "right",
        textShadow,
      } as CSSProperties}
    >
      <span className="af-lyric-line-main">{line.text}</span>
      {line.translation && (
        <span className="af-lyric-line-translation">{line.translation}</span>
      )}
    </div>
  );
}

interface KaraokeLineProps {
  line: DesktopLyricDisplayLine;
  /** 当前行播放进度（秒，已含手动偏移） */
  progress: number;
  align: string;
  activeColor: string;
  enableAnimation: boolean;
  fontSize: number;
  fontWeight: number;
  shadowColor: string;
}

/** word.start 可能是绝对时间，也可能相对行首，按行起始时间归一（与 playbackSync 判定一致） */
function getWordAbsoluteStart(lineStart: number, wordStart: number) {
  return wordStart >= lineStart ? wordStart : lineStart + wordStart;
}

/** 当前行的逐字卡拉OK 渲染：外层结构复用 LyricLineText 的当前行样式 */
const KaraokeLine = memo(function KaraokeLine({
  line,
  progress,
  align,
  activeColor,
  enableAnimation,
  fontSize,
  fontWeight,
  shadowColor,
}: KaraokeLineProps) {
  const karaokeWords = (line.words ?? []).filter((word) => word.text.trim().length > 0);
  const lineStart = line.time ?? 0;
  const lineProgress = `${Math.round((line.progress ?? 0) * 1000) / 10}%`;

  return (
    <div
      className={[
        "af-lyric-line",
        "af-lyric-line-now",
        enableAnimation ? "af-lyric-line-animated" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        "--af-lyric-active-color": activeColor,
        "--af-lyric-line-progress": lineProgress,
        color: activeColor,
        fontSize: `${fontSize}px`,
        fontWeight,
        textAlign: align as "left" | "center" | "right",
        textShadow: `0 1px 8px ${shadowColor}`,
      } as CSSProperties}
    >
      {karaokeWords.length > 0 ? (
        <span className="af-lyric-line-main af-lyric-karaoke">
          {karaokeWords.map((word, index) => {
            const start = getWordAbsoluteStart(lineStart, word.start);
            const end = start + Math.max(0, word.dur);
            if (progress >= end) {
              return (
                <span key={index} className="af-lyric-karaoke-word af-lyric-karaoke-word-sung">
                  {word.text}
                </span>
              );
            }
            if (progress < start) {
              return (
                <span key={index} className="af-lyric-karaoke-word">
                  {word.text}
                </span>
              );
            }
            const wordProgress = word.dur > 0 ? (progress - start) / word.dur : 1;
            const wordPercent = `${Math.min(100, Math.max(0, Math.round(wordProgress * 1000) / 10))}%`;
            return (
              <span
                key={index}
                className="af-lyric-karaoke-word af-lyric-karaoke-word-active"
                style={{ "--af-lyric-word-progress": wordPercent } as CSSProperties}
              >
                {word.text}
              </span>
            );
          })}
        </span>
      ) : (
        <span className="af-lyric-line-main">{line.text}</span>
      )}
      {line.translation && (
        <span className="af-lyric-line-translation">{line.translation}</span>
      )}
    </div>
  );
});
