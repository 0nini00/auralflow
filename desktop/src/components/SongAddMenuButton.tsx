import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Cloud, Heart, ListMusic, ListPlus } from "lucide-react";
import type { MusicInfo } from "@lx/core";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useWyAccountStore } from "@/stores/wyAccountStore";

interface SongAddMenuButtonProps {
  song: MusicInfo;
  className?: string;
  iconSize?: number;
  title?: string;
}

export interface SongAddMenuProps {
  song: MusicInfo;
  /** 触发按钮：菜单按它的位置定位，Esc 关闭后焦点交还给它 */
  anchor: HTMLElement;
  onClose: () => void;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT_ESTIMATE = 300;

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
 * 受控的「添加到」菜单（portal + 按触发按钮定位 + Esc 关闭）。
 * 长列表整表共用一个实例即可，不必每行各建一份状态与 store 订阅。
 */
export function SongAddMenu({ song, anchor, onClose }: SongAddMenuProps) {
  const [position] = useState(() => getMenuPosition(anchor));
  const [pendingWyPlaylistId, setPendingWyPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const anchorRef = useRef(anchor);
  const songKey = `${song.source}:${song.id}`;

  useEffect(() => {
    onCloseRef.current = onClose;
    anchorRef.current = anchor;
  }, [anchor, onClose]);

  useEffect(() => {
    setPendingWyPlaylistId(null);
    setError("");
  }, [songKey]);

  useEffect(() => {
    // role="menu"：打开即把焦点交给首个可用项，Esc 关闭并把焦点交还触发按钮
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onCloseRef.current();
      anchorRef.current.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const handleAddFavorite = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    addFavorite(song);
    close();
  };

  const handleAddLocalPlaylist = (event: MouseEvent<HTMLButtonElement>, playlistId: string) => {
    event.stopPropagation();
    addSongToPlaylist(playlistId, song);
    close();
  };

  const handleAddWyPlaylist = async (event: MouseEvent<HTMLButtonElement>, playlistId: string) => {
    event.stopPropagation();
    setPendingWyPlaylistId(playlistId);
    setError("");
    try {
      await wyAddTracks(playlistId, [song]);
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingWyPlaylistId(null);
    }
  };

  return createPortal(
    <>
      <div className="af-add-menu-backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={menuRef}
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
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
      >
        <ListPlus size={iconSize} />
      </button>

      {anchor && (
        <SongAddMenu
          key={`${song.source}:${song.id}`}
          song={song}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}