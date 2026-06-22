/**
 * 桌面歌词独立窗口的视图。
 * 透明背景 + 居中两行歌词 + 简易 mini 控件。
 * 状态来自 playerSync 接收主窗口广播；按钮通过 dispatchLyricAction 反向。
 */

import { usePlayerStore } from "@/stores/playerStore";
import { useLyrics } from "@/hooks/useLyrics";
import { dispatchLyricAction } from "@/stores/playerSync";
import { subscribeLyricSettings, broadcastLyricSettings } from "@/stores/lyricSettingsSync";
import { buildDesktopLyricLines, type DesktopLyricDisplayLine } from "@/utils/desktopLyric";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getLyricWindowState, loadSettings, patchSettings, prepareLyricWindowLock, setLyricWindowPinned, setLyricWindowLocked, toggleLyricWindow } from "@lx/tauri-bridge";
import { Play, Pause, SkipBack, SkipForward, X, Pin, PinOff, Plus, Minus, Lock, Unlock } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useState } from "react";

export function LyricWindowView() {
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.progress);

  const { lyrics, currentLine } = useLyrics(current, progress);
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
        try {
          const runtimeState = await getLyricWindowState();
          if (!disposed) setLocked(runtimeState.locked);
        } catch {
          // Keep the default unlocked UI rather than trusting stale persisted lock state.
        }
      })
      .catch(() => {});

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
  });

  useEffect(() => {
    const window = getCurrentWindow();
    if (pauseHide && current && status === "paused") {
      void window.hide().catch(() => {});
    } else {
      void window.show().catch(() => {});
    }
  }, [current, pauseHide, status]);

  const handleClose = () => {
    void toggleLyricWindow().catch(() => {});
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
    void patchSettings({ lyricFontSize: next }).catch(() => {});
  };

  const startWindowDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div
      className={`af-lyric-shell ${hoverHide ? "af-lyric-hover-hide" : ""} ${locked ? "af-lyric-locked" : ""}`}
      style={{ "--af-lyric-panel-opacity": Math.min(backgroundOpacity, 0.28) } as CSSProperties}
      onMouseDown={startWindowDrag}
    >
      {/* 拖拽手柄：整条横向背景，data-tauri-drag-region 让窗口跟随鼠标拖动 */}
      <div className="af-lyric-drag" data-tauri-drag-region>
        <div className="af-lyric-tools">
          <button
            type="button"
            className="af-lyric-tool"
            onClick={() => dispatchLyricAction("prev")}
            title="上一首"
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className="af-lyric-tool af-lyric-tool-primary"
            onClick={() => dispatchLyricAction("play-pause")}
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="af-lyric-tool"
            onClick={() => dispatchLyricAction("next")}
            title="下一首"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="af-lyric-meta">
          {current ? (
            <>
              <span className="af-lyric-track">{current.name}</span>
              <span className="af-lyric-singer"> · {current.singer}</span>
            </>
          ) : (
            <span className="af-lyric-track">未在播放</span>
          )}
        </div>

        <div className="af-lyric-tools">
          <button
            type="button"
            className="af-lyric-tool"
            onClick={() => adjustFontSize(-2)}
            title="减小字号"
            disabled={fontSize <= 16}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="af-lyric-tool"
            onClick={() => adjustFontSize(2)}
            title="增大字号"
            disabled={fontSize >= 52}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className={`af-lyric-tool ${pinned ? "af-lyric-tool-active" : ""}`}
            onClick={togglePinned}
            title={pinned ? "取消始终显示在其他窗口上方" : "始终显示在其他窗口上方"}
          >
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            type="button"
            className={`af-lyric-tool ${locked ? "af-lyric-tool-active" : ""}`}
            onClick={toggleLocked}
            title={locked ? "解锁窗口" : "锁定窗口"}
          >
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
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
      </div>

      <div
        className="af-lyric-stage"
        style={{
          gap: `${lineGap}px`,
          opacity: textOpacity,
          transform: `translate(${textPositionX}%, ${textPositionY}%)`,
        }}
      >
        {displayLines.map((line) => (
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
        ))}
      </div>

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
        .af-lyric-shell:hover .af-lyric-drag {
          opacity: 1;
        }
        .af-lyric-shell.af-lyric-hover-hide:hover {
          opacity: 0.08;
        }
        .af-lyric-locked .af-lyric-drag {
          display: none;
        }
        .af-lyric-drag {
          position: absolute;
          top: 8px;
          left: 50%;
          width: min(680px, calc(100% - 28px));
          z-index: 2;
          display: grid;
          grid-template-columns: auto minmax(160px, 1fr) auto;
          align-items: center;
          gap: 10px;
          padding: 7px 12px;
          opacity: 0;
          transform: translateX(-50%);
          transition: opacity 0.2s;
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
          gap: 4px;
        }
        .af-lyric-tools:first-child {
          justify-content: flex-start;
        }
        .af-lyric-tools:last-child {
          justify-content: flex-end;
        }
        .af-lyric-tool {
          width: 28px;
          height: 28px;
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
          background: rgba(34, 197, 94, 0.6);
          color: #fff;
        }
        .af-lyric-tool-active:hover {
          background: rgba(34, 197, 94, 0.85);
        }
        .af-lyric-tool-primary {
          width: 32px;
          height: 32px;
          background: rgba(34, 197, 94, 0.85);
          color: #fff;
        }
        .af-lyric-tool-primary:hover {
          background: rgba(34, 197, 94, 1);
        }
        .af-lyric-tool-danger:hover {
          background: rgba(239, 68, 68, 0.85);
          color: #fff;
        }
        .af-lyric-meta {
          flex: 1;
          min-width: 0;
          font-size: 12px;
          color: rgba(255,255,255,0.7);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: center;
        }
        .af-lyric-track {
          color: #fff;
          font-weight: 600;
        }
        .af-lyric-singer {
          color: rgba(255,255,255,0.6);
        }
        .af-lyric-stage {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 0;
          padding: 28px 34px 18px;
          pointer-events: none;
        }
        .af-lyric-line {
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0;
          paint-order: stroke fill;
          -webkit-text-stroke: 0.6px rgba(0, 0, 0, 0.34);
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
        @keyframes af-lyric-fade {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
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
  const textShadow = isCurrent
    ? `0 2px 12px ${shadowColor}`
    : `0 1px 6px ${shadowColor}`;

  return (
    <div
      className={[
        "af-lyric-line",
        isCurrent ? "af-lyric-line-now" : "af-lyric-line-next",
        isEmpty ? "af-lyric-line-empty" : "",
        enableAnimation && isCurrent ? "af-lyric-line-animated" : "",
      ].filter(Boolean).join(" ")}
      style={{
        color: isCurrent ? activeColor : nextColor,
        fontSize: `${size}px`,
        fontWeight: isCurrent ? fontWeight : 500,
        textAlign: align as "left" | "center" | "right",
        textShadow,
      }}
    >
      {line.text}
      {line.translation && (
        <span className="af-lyric-line-translation">{line.translation}</span>
      )}
    </div>
  );
}
