import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showMainWindow, showMiniPlayerMenu } from "@lx/tauri-bridge";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { useInterpolatedPlaybackProgress } from "@/hooks/useInterpolatedPlaybackProgress";
import { usePlayerStore } from "@/stores/playerStore";
import { dispatchLyricAction } from "@/stores/playerSync";
import { applyInitialAppearance, useThemeStore } from "@/stores/themeStore";
import { coverSrc } from "@/utils/imageReferrerPolicy";
import { formatTime } from "@/utils/formatTime";

/** 双击判定窗口：两次点击间隔小于它、且都没拖动，就算双击。 */
const DOUBLE_CLICK_MS = 500;
/** 鼠标移动超过这么多像素才开始拖窗，避免「想双击却拖了一下」。 */
const DRAG_THRESHOLD_PX = 3;
/**
 * 迷你播放器（隐藏到托盘后的常驻小条）。
 *
 * 状态由 playerSync 从主窗口广播过来，控件动作经同一条通道回传给主窗口执行——
 * 音频始终只有主窗口那一份，这里纯展示 + 转发，不碰 playback。
 *
 * 交互：拖动 = 移动窗口（Rust 侧负责吸附与位置记忆）；双击 = 回到主窗口；
 * 右键 = 原生菜单（窗口只有 76px 高，HTML 菜单会被窗口边界裁掉）。
 * 配色全部走主题变量，跟随主窗口的明暗与强调色。
 */
export function MiniPlayerView() {
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.progress);
  const progressSampledAt = usePlayerStore((s) => s.progressSampledAt);
  const duration = usePlayerStore((s) => s.duration);
  const playbackRate = usePlayerStore((s) => s.playbackRate);

  const time = useInterpolatedPlaybackProgress({
    status,
    progress,
    progressSampledAt,
    duration,
    playbackRate,
  });
  const playing = status === "playing";
  const cover = coverSrc(current?.img || current?.picUrl || "", 48);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;

  const pressRef = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const lastClickRef = useRef(0);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      void showMiniPlayerMenu().catch(() => undefined);
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // 主窗口改了明暗/强调色时跟着换：两个窗口是不同的 WebView，
  // 只有 localStorage 变化能传过来（同一个 origin，persist 用的是 "af-theme"）。
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "af-theme") return;
      void Promise.resolve(useThemeStore.persist.rehydrate()).then(() => applyInitialAppearance());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 拖窗必须自己实现：data-tauri-drag-region 一按下就进入系统移动循环，
  // 第二次点击根本到不了 webview，双击呼出主窗口就失效了。
  const isActionTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest(".af-mini-player-actions") != null;

  const lastRestoreRef = useRef(0);
  /** 双击回主窗口。原生 dblclick 与下面的手动计数可能同时命中，用时间戳去重。 */
  const restoreMainWindow = () => {
    const now = Date.now();
    if (now - lastRestoreRef.current < 600) return;
    lastRestoreRef.current = now;
    void showMainWindow().catch(() => undefined);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isActionTarget(event.target)) return;
    pressRef.current = { x: event.screenX, y: event.screenY, dragging: false };
    // 必须捕获指针：这条窗口只有 76px 高，鼠标稍微往上下偏一点就收不到 pointermove，
    // 拖拽会永远停在「差一点点位移」的状态（表现为窗口拖不动）。
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.dragging) return;
    if (
      Math.abs(event.screenX - press.x) < DRAG_THRESHOLD_PX &&
      Math.abs(event.screenY - press.y) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    press.dragging = true;
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("[mini-player] 拖动窗口失败", error);
      });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (isActionTarget(event.target) || !press || press.dragging) return;
    const now = Date.now();
    if (now - lastClickRef.current < DOUBLE_CLICK_MS) {
      lastClickRef.current = 0;
      restoreMainWindow();
      return;
    }
    lastClickRef.current = now;
  };

  return (
    <div
      className="af-mini-player"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={restoreMainWindow}
    >
      <div className="af-mini-player-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="af-mini-player-body">
        <div className="af-mini-player-cover">
          {cover ? (
            <img src={cover} alt="" draggable={false} />
          ) : (
            <div className="af-mini-player-cover-fallback" aria-hidden="true" />
          )}
        </div>
        <div className="af-mini-player-meta">
          <p className="af-mini-player-title">{current?.name ?? "未在播放"}</p>
          <p className="af-mini-player-subtitle">
            {current ? [current.singer, formatTime(time)].filter(Boolean).join(" · ") : "托盘里待命"}
          </p>
        </div>
        <div className="af-mini-player-actions">
          <button
            type="button"
            className="af-mini-player-button"
            aria-label="上一首"
            disabled={!current}
            onClick={() => dispatchLyricAction("prev")}
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className="af-mini-player-button af-mini-player-play"
            aria-label={playing ? "暂停" : "播放"}
            disabled={!current}
            onClick={() => dispatchLyricAction("play-pause")}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="af-mini-player-button"
            aria-label="下一首"
            disabled={!current}
            onClick={() => dispatchLyricAction("next")}
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* 只在迷你播放器窗口生效的样式：窗口本身透明，条是本组件画的。
          与桌面歌词同样的做法（inline style 块），避免污染主窗口的全局背景。
          配色一律取主题变量，所以跟随明暗与强调色，不再是一块固定黑。 */}
      <style>{`
        html, body, #root {
          background: transparent !important;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
        .af-mini-player {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          border-radius: 14px;
          border: 1px solid var(--af-border-primary);
          background: color-mix(in srgb, var(--af-bg-elevated) 90%, transparent);
          box-shadow: var(--af-shadow-lg);
          color: var(--af-text-primary);
          -webkit-font-smoothing: antialiased;
          user-select: none;
          overflow: hidden;
        }
        .af-mini-player-progress {
          flex: none;
          height: 3px;
          background: color-mix(in srgb, var(--af-text-primary) 12%, transparent);
        }
        .af-mini-player-progress > span {
          display: block;
          height: 100%;
          background: var(--af-accent-primary);
          transition: width 0.2s linear;
        }
        .af-mini-player-body {
          flex: 1;
          min-height: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 10px;
        }
        .af-mini-player-cover {
          flex: none;
          width: 52px;
          height: 52px;
          border-radius: 8px;
          overflow: hidden;
          background: color-mix(in srgb, var(--af-text-primary) 8%, transparent);
        }
        .af-mini-player-cover img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .af-mini-player-cover-fallback {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--af-text-primary) 16%, transparent),
            color-mix(in srgb, var(--af-text-primary) 4%, transparent)
          );
        }
        .af-mini-player-meta {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .af-mini-player-title {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .af-mini-player-subtitle {
          margin: 0;
          font-size: 11px;
          color: var(--af-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .af-mini-player-actions {
          flex: none;
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .af-mini-player-button {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .af-mini-player-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--af-text-primary) 12%, transparent);
        }
        .af-mini-player-button:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .af-mini-player-play {
          width: 34px;
          height: 34px;
          background: var(--af-accent-primary);
          color: var(--af-text-on-accent, #ffffff);
        }
        .af-mini-player-play:hover:not(:disabled) {
          background: var(--af-accent-hover, var(--af-accent-primary));
        }
      `}</style>
    </div>
  );
}
