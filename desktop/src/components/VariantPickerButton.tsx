import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Layers, Star } from "lucide-react";
import type { MusicInfo } from "@lx/core";
import { buildSongKey, getSongVariants, orderPlaybackCandidates, withSongVariants } from "@lx/core";
import { usePlayerStore } from "@/stores/playerStore";
import { useVariantPinStore } from "@/stores/variantPinStore";
import { formatDuration } from "@/lib/utils";

interface VariantPickerButtonProps {
  song: MusicInfo;
  className?: string;
  iconSize?: number;
  title?: string;
}

export interface VariantPickerMenuProps {
  song: MusicInfo;
  /** 触发按钮：菜单按它的位置定位，Esc 关闭后焦点交还给它 */
  anchor: HTMLElement;
  onClose: () => void;
}

const MENU_WIDTH = 340;
const MENU_HEIGHT_ESTIMATE = 320;

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  local: "本地",
};

function getMenuPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
  const belowTop = rect.bottom + 6;
  const top = belowTop + MENU_HEIGHT_ESTIMATE > window.innerHeight
    ? Math.max(8, rect.top - MENU_HEIGHT_ESTIMATE - 6)
    : belowTop;

  return { top, left };
}

/**
 * 受控的「其他版本」菜单（portal + 按触发按钮定位 + Esc 关闭）。
 * 列出同一首歌的跨源候选（主版本在前，其后按搜索匹配度排序）：
 * 点击条目即播放该版本；星标把版本记为「本机首选」，后续解析优先生效（不参与云同步）。
 */
export function VariantPickerMenu({ song, anchor, onClose }: VariantPickerMenuProps) {
  const menuId = useId();
  const [position] = useState(() => getMenuPosition(anchor));
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  const groupKey = buildSongKey(song);
  const variants = getSongVariants(song);
  const pinnedKey = useVariantPinStore((s) => s.pins[groupKey] ?? null);
  const togglePinnedVariant = useVariantPinStore((s) => s.togglePinnedVariant);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousControls = anchor.getAttribute("aria-controls");
    anchor.setAttribute("aria-controls", previousControls ? `${previousControls} ${menuId}` : menuId);
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onCloseRef.current();
      anchor.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousControls === null) anchor.removeAttribute("aria-controls");
      else anchor.setAttribute("aria-controls", previousControls);
    };
  }, [anchor, menuId]);

  // 展示顺序固定为主版本在前（pin 只影响播放解析顺序，不重排菜单，避免星标后条目跳动）
  const candidates = orderPlaybackCandidates(song);

  const handlePlay = (event: MouseEvent<HTMLButtonElement>, candidate: MusicInfo) => {
    event.stopPropagation();
    // 选中版本作为新队列播单：变体列表随主条目进入解析链，后续自动兜底仍然可用
    usePlayerStore.getState().playQueue([withSongVariants(candidate, variants)], 0);
    onClose();
  };

  const handleTogglePin = (event: MouseEvent<HTMLButtonElement>, candidate: MusicInfo) => {
    event.stopPropagation();
    togglePinnedVariant(groupKey, buildSongKey(candidate));
  };

  return createPortal(
    <>
      <div className="af-add-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={menuRef}
        id={menuId}
        className="af-dropdown-menu af-variant-menu"
        role="menu"
        style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH, zIndex: 9999 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="af-add-menu-label">
          <Layers size={13} />
          <span>其他版本</span>
        </div>
        {candidates.map((candidate) => {
          const candidateKey = buildSongKey(candidate);
          const pinned = pinnedKey === candidateKey;
          return (
            <div key={candidateKey} className="af-variant-row">
              <button
                type="button"
                className="af-variant-main"
                onClick={(event) => handlePlay(event, candidate)}
                title={`播放：${candidate.name}`}
              >
                <span className="af-variant-source">{SOURCE_LABELS[candidate.source] ?? candidate.source}</span>
                <span className="af-variant-name">{candidate.name}</span>
                <span className="af-variant-meta">{candidate.singer}</span>
                <span className="af-variant-duration">{formatDuration(candidate.interval ?? 0)}</span>
              </button>
              <button
                type="button"
                className={`af-variant-pin${pinned ? " is-pinned" : ""}`}
                onClick={(event) => handleTogglePin(event, candidate)}
                title={pinned ? "取消本机首选" : "设为本机首选"}
                aria-label={pinned ? `取消 ${candidate.name} 的本机首选` : `把 ${candidate.name} 设为本机首选`}
                aria-pressed={pinned}
              >
                <Star size={14} fill={pinned ? "currentColor" : "none"} />
              </button>
            </div>
          );
        })}
        <div className="af-add-menu-status">星标记住本机首选版本，不参与云同步</div>
      </div>
    </>,
    document.body,
  );
}

export function VariantPickerButton({
  song,
  className = "af-action-btn",
  iconSize = 16,
  title = "其他版本",
}: VariantPickerButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const trigger = event.currentTarget;
    setAnchor((current) => (current ? null : trigger));
  };

  // 无跨源版本时不渲染入口（单行点击/其它操作按钮已覆盖全部动作）
  if (getSongVariants(song).length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleToggle}
        data-tooltip={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
      >
        <Layers size={iconSize} />
      </button>

      {anchor && (
        <VariantPickerMenu
          key={buildSongKey(song)}
          song={song}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
