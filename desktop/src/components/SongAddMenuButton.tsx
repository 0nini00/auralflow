import { getMenuPosition } from "@/utils/menuPosition";
import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Cloud, Heart, ListMusic, ListPlus } from "lucide-react";
import type { MusicInfo } from "@lx/core";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { showToast } from "@/components/ui/Toast";
import { useWyAccountStore } from "@/stores/wyAccountStore";

interface SongAddMenuButtonProps {
  song: MusicInfo;
  className?: string;
  iconSize?: number;
  title?: string;
  /** 可选菜单行文字；不传时保留列表中的图标按钮。 */
  label?: string;
  /**
   * 菜单被「点空白 / Esc」收起时回调。
   * 沉浸页的「更多」面板里挂着这个按钮：一次点空白要连同面板一起收起，
   * 只关掉菜单会留下一个只剩半屏浮层的中间状态。
   */
  onDismiss?: () => void;
}

export interface SongAddMenuProps {
  song: MusicInfo;
  /** 触发按钮：菜单按它的位置定位，Esc 关闭后焦点交还给它 */
  anchor: HTMLElement;
  onClose: () => void;
  /** 同 SongAddMenuButtonProps.onDismiss：只有「点空白 / Esc」这条路径会触发。 */
  onDismiss?: () => void;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT_ESTIMATE = 300;

/**
 * 受控的「添加到」菜单（portal + 按触发按钮定位 + Esc 关闭）。
 * 长列表整表共用一个实例即可，不必每行各建一份状态与 store 订阅。
 */
export function SongAddMenu({ song, anchor, onClose, onDismiss }: SongAddMenuProps) {
  const menuId = useId();
  const [position] = useState(() => getMenuPosition(
    anchor.getBoundingClientRect(),
    { width: MENU_WIDTH, height: MENU_HEIGHT_ESTIMATE },
    { width: window.innerWidth, height: window.innerHeight },
  ));
  const [pendingWyPlaylistId, setPendingWyPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onDismissRef = useRef(onDismiss);
  const songKey = `${song.source}:${song.id}`;

  useEffect(() => {
    onCloseRef.current = onClose;
    onDismissRef.current = onDismiss;
  }, [onClose, onDismiss]);

  useEffect(() => {
    setPendingWyPlaylistId(null);
    setError("");
  }, [songKey]);

  useEffect(() => {
    // 归属由实际 anchor 声明，同时覆盖按钮封装与列表共享的受控菜单入口。
    const previousControls = anchor.getAttribute("aria-controls");
    anchor.setAttribute("aria-controls", previousControls ? `${previousControls} ${menuId}` : menuId);
    // 先声明归属，再聚焦 portal，父弹窗才能将菜单纳入同一 Tab 序列。
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

  const playlists = usePlaylistStore((s) => s.playlists);
  const addSongToPlaylist = usePlaylistStore((s) => s.addSongToPlaylist);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const isFavorite = useFavoritesStore((s) => s.isFavorite(song));
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyAddTracks = useWyAccountStore((s) => s.addTracks);

  const ownedWyPlaylists = wyPlaylists.filter((playlist) => !playlist.subscribed);
  // 加入网易云自建歌单需要网易云账号，未登录时不显示该区块（本地歌单与「我的喜欢」不受影响）
  const canAddToWyPlaylist = song.source === "wy" && !!wyAccount;

  const close = () => {
    setError("");
    onClose();
  };

  /** 点空白：先收起菜单，再让宿主决定要不要连带收起自己的面板。 */
  const dismiss = () => {
    close();
    onDismissRef.current?.();
  };

  const handleAddFavorite = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    addFavorite(song);
    close();
    showToast("已加入我的喜欢");
  };

  const handleAddLocalPlaylist = (event: MouseEvent<HTMLButtonElement>, playlistId: string) => {
    event.stopPropagation();
    addSongToPlaylist(playlistId, song);
    close();
    // 成功后必须给一声回声：此前面板直接关掉，用户无法确认到底加没加进去
    const target = playlists.find((item) => item.id === playlistId);
    showToast(target ? `已加入「${target.name}」` : "已加入歌单");
  };

  const handleAddWyPlaylist = async (event: MouseEvent<HTMLButtonElement>, playlistId: string) => {
    event.stopPropagation();
    setPendingWyPlaylistId(playlistId);
    setError("");
    try {
      await wyAddTracks(playlistId, [song]);
      close();
      showToast("已加入网易云歌单");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingWyPlaylistId(null);
    }
  };

  return createPortal(
    <>
      <div className="af-add-menu-backdrop" onClick={dismiss} aria-hidden="true" />
      <div
        ref={menuRef}
        id={menuId}
        className="af-dropdown-menu af-add-menu"
        role="menu"
        style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH, zIndex: 9999 }}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={handleAddFavorite} disabled={isFavorite}>
          {isFavorite ? <Check size={14} /> : <Heart size={14} />}
          <span>{isFavorite ? "已在我的喜欢" : "添加到我的喜欢"}</span>
        </button>

        <div className="af-add-menu-label">
          <ListMusic size={13} />
          <span>本地歌单</span>
        </div>
        {playlists.length > 0 ? playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            onClick={(event) => handleAddLocalPlaylist(event, playlist.id)}
          >
            <ListPlus size={14} />
            <span>{playlist.name}</span>
          </button>
        )) : (
          <div className="af-add-menu-status">暂无本地歌单</div>
        )}

        {canAddToWyPlaylist && (
          <>
            <div className="af-add-menu-label">
              <Cloud size={13} />
              <span>网易云自建歌单</span>
            </div>
            {ownedWyPlaylists.length > 0 ? ownedWyPlaylists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={(event) => handleAddWyPlaylist(event, playlist.id)}
                disabled={pendingWyPlaylistId === playlist.id}
              >
                <ListPlus size={14} />
                <span>{pendingWyPlaylistId === playlist.id ? "添加中..." : playlist.name}</span>
              </button>
            )) : (
              <div className="af-add-menu-status">暂无网易云自建歌单</div>
            )}
          </>
        )}
        {error && <div className="af-add-menu-status af-add-menu-error">{error}</div>}
      </div>
    </>,
    document.body,
  );
}

export function SongAddMenuButton({
  song,
  className = "af-action-btn",
  iconSize = 16,
  title = "添加到",
  label,
  onDismiss,
}: SongAddMenuButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // currentTarget 在事件派发结束后会被置空，先取出再进 updater
    const trigger = event.currentTarget;
    setAnchor((current) => (current ? null : trigger));
  };
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleToggle}
        data-tooltip={title}
        aria-label={label ?? title}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
      >
        <ListPlus size={iconSize} />
        {label && <><span>{label}</span><ChevronRight size={15} aria-hidden="true" /></>}
      </button>

      {anchor && (
        <SongAddMenu
          key={`${song.source}:${song.id}`}
          song={song}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          onDismiss={onDismiss}
        />
      )}
    </>
  );
}