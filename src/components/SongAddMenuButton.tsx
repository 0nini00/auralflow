import { useState } from "react";
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

export function SongAddMenuButton({
  song,
  className = "af-action-btn",
  iconSize = 16,
  title = "添加到",
}: SongAddMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [pendingWyPlaylistId, setPendingWyPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const playlists = usePlaylistStore((s) => s.playlists);
  const addSongToPlaylist = usePlaylistStore((s) => s.addSongToPlaylist);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const isFavorite = useFavoritesStore((s) => s.isFavorite(song));
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyAddTracks = useWyAccountStore((s) => s.addTracks);

  const ownedWyPlaylists = wyPlaylists.filter((playlist) => !playlist.subscribed);
  const canAddToWyPlaylist = song.source === "wy";

  const close = () => {
    setOpen(false);
    setError("");
  };

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuPos(getMenuPosition(event.currentTarget));
    setError("");
    setOpen((value) => !value);
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

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleToggle}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ListPlus size={iconSize} />
      </button>

      {open && menuPos && createPortal(
        <>
          <div className="af-add-menu-backdrop" onClick={close} aria-hidden="true" />
          <div
            className="af-dropdown-menu af-add-menu"
            role="menu"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH, zIndex: 9999 }}
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
      )}
    </>
  );
}
