import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play, Plus, Music2, Bookmark, BookmarkCheck, User } from "lucide-react";
import { registry } from "../services/sources";
import { usePlayerStore } from "../stores/playerStore";
import { useWyAccountStore } from "../stores/wyAccountStore";
import { usePlaylistStore } from "../stores/playlistStore";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";
import { logAsyncError } from "@/utils/logAsyncError";
import type { MusicInfo, PlaylistInfo, ArtistInfo, SearchResult, SearchType } from "@lx/core";

type SearchSource = "all" | "wy" | "tx";

type SearchSourceBadge = "wy" | "tx";

interface CombinedSongResult {
  key: string;
  primary: MusicInfo;
  variants: MusicInfo[];
  sources: SearchSourceBadge[];
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

function splitSingerTokens(singer: string): string[] {
  return singer
    .split(/[、/,，&＋+]/)
    .map(normalizeText)
    .filter(Boolean);
}

function hasSingerOverlap(a: MusicInfo, b: MusicInfo): boolean {
  const singersA = splitSingerTokens(a.singer);
  const singersB = splitSingerTokens(b.singer);
  if (singersA.length === 0 || singersB.length === 0) return false;
  return singersA.some((singerA) => singersB.some((singerB) => singerA === singerB));
}

function isSameSong(a: MusicInfo, b: MusicInfo): boolean {
  if (normalizeText(a.name) !== normalizeText(b.name)) return false;
  if (!hasSingerOverlap(a, b)) return false;

  if (a.interval && b.interval) {
    return Math.abs(a.interval - b.interval) <= 6;
  }

  return true;
}

function sourceRank(source: MusicInfo["source"]): number {
  if (source === "wy") return 0;
  if (source === "tx") return 1;
  return 2;
}

function groupSongResults(songs: MusicInfo[]): CombinedSongResult[] {
  const groups: CombinedSongResult[] = [];

  for (const song of songs) {
    const existing = groups.find((group) => group.variants.some((variant) => isSameSong(variant, song)));
    if (!existing) {
      groups.push({
        key: `${normalizeText(song.name)}:${normalizeText(song.singer)}:${song.interval ?? 0}`,
        primary: song,
        variants: [song],
        sources: song.source === "wy" || song.source === "tx" ? [song.source] : [],
      });
      continue;
    }

    if (!existing.variants.some((variant) => variant.source === song.source && variant.id === song.id)) {
      existing.variants.push(song);
    }

    if ((song.source === "wy" || song.source === "tx") && !existing.sources.includes(song.source)) {
      existing.sources.push(song.source);
      existing.sources.sort((a, b) => sourceRank(a) - sourceRank(b));
    }

    existing.variants.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
    existing.primary = existing.variants[0];
  }

  return groups;
}

function buildSearchKey(keyword: string, type: SearchType, source: SearchSource): string {
  return `${keyword}\u0000${type}\u0000${source}`;
}

function buildPlaylistDetailPath(playlist: PlaylistInfo): string {
  return `/playlist/${encodeURIComponent(playlist.id)}?source=${playlist.source}`;
}

function buildImportedPlaylistMarker(playlist: PlaylistInfo): string {
  return `[af-imported-playlist:${playlist.source}:${playlist.id}]`;
}

function getUnavailableSearchMessage(type: SearchType, source: SearchSource): string {
  if (type === "singer" && source === "tx") return "QQ 音乐暂不支持歌手搜索";
  return "";
}

async function searchBySource(
  keyword: string,
  type: SearchType,
  source: SearchSource,
): Promise<SearchResult> {
  if (source !== "all") {
    const provider = registry.get(source);
    if (!provider) return {};
    if (!provider.supportedSearchTypes.includes(type)) return {};
    return provider.search(keyword, type, 1);
  }

  const providers = [registry.get("wy"), registry.get("tx")]
    .filter((provider) => provider?.supportedSearchTypes.includes(type));
  const settled = await Promise.allSettled(
    providers.map((provider) => provider!.search(keyword, type, 1)),
  );
  const result: SearchResult = { songs: [], playlists: [], artists: [], albums: [] };
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const item of settled) {
    if (item.status === "rejected") {
      errors.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
      continue;
    }

    for (const song of item.value.songs ?? []) {
      const key = `song:${song.source}:${song.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.songs!.push(song);
    }

    for (const playlist of item.value.playlists ?? []) {
      const key = `pl:${playlist.source}:${playlist.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.playlists!.push(playlist);
    }

    for (const artist of item.value.artists ?? []) {
      const key = `ar:${artist.source}:${artist.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.artists!.push(artist);
    }

    for (const album of item.value.albums ?? []) {
      const key = `al:${album.source}:${album.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.albums!.push(album);
    }
  }

  const totalCount =
    (result.songs?.length ?? 0) +
    (result.playlists?.length ?? 0) +
    (result.artists?.length ?? 0) +
    (result.albums?.length ?? 0);

  if (totalCount === 0 && errors.length > 0) {
    throw new Error(errors.join("；"));
  }

  return result;
}

export function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [activeType, setActiveType] = useState<SearchType>("song");
  const [activeSource, setActiveSource] = useState<SearchSource>("all");
  const [songResults, setSongResults] = useState<MusicInfo[]>([]);
  const [playlistResults, setPlaylistResults] = useState<PlaylistInfo[]>([]);
  const [artistResults, setArtistResults] = useState<ArtistInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [unavailableMessage, setUnavailableMessage] = useState("");
  const [actionStatus, setActionStatus] = useState("");

  const playQueue = usePlayerStore((s) => s.playQueue);
  const localPlaylists = usePlaylistStore((s) => s.playlists);
  const importPlaylist = usePlaylistStore((s) => s.importPlaylist);
  const updatePlaylistCover = usePlaylistStore((s) => s.updatePlaylistCover);
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyLoad = useWyAccountStore((s) => s.load);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wySetSubscribed = useWyAccountStore((s) => s.setSubscribed);
  const wyCollectedIds = new Set(wyPlaylists.map((p) => p.id));
  const importedPlaylistMarkers = new Set(
    localPlaylists
      .map((playlist) => playlist.description?.match(/\[af-imported-playlist:[^\]]+\]/)?.[0])
      .filter((marker): marker is string => Boolean(marker)),
  );
  const [busyPlaylistKey, setBusyPlaylistKey] = useState<string | null>(null);
  const searchRequestSeqRef = useRef(0);
  const lastStartedSearchKeyRef = useRef<string | null>(null);

  const handleSearch = useCallback(async (
    term = query,
    options?: { type?: SearchType; source?: SearchSource; updateUrl?: boolean },
  ) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const nextType = options?.type ?? activeType;
    const nextSource = options?.source ?? activeSource;
    const requestId = searchRequestSeqRef.current + 1;
    const searchKey = buildSearchKey(trimmed, nextType, nextSource);
    const nextUnavailableMessage = getUnavailableSearchMessage(nextType, nextSource);

    searchRequestSeqRef.current = requestId;
    lastStartedSearchKeyRef.current = searchKey;
    setQuery(trimmed);
    if (options?.updateUrl !== false) {
      setSearchParams({ q: trimmed });
    }
    setLoading(true);
    setSearched(true);
    setSearchError("");
    setUnavailableMessage(nextUnavailableMessage);
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);

    if (nextUnavailableMessage) {
      setLoading(false);
      return;
    }

    try {
      const res = await searchBySource(trimmed, nextType, nextSource);
      if (requestId !== searchRequestSeqRef.current) return;
      setSongResults(res.songs ?? []);
      setPlaylistResults(res.playlists ?? []);
      setArtistResults(res.artists ?? []);
    } catch (error) {
      if (requestId !== searchRequestSeqRef.current) return;
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === searchRequestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [activeSource, activeType, query, setSearchParams]);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!trimmed) return;

    const searchKey = buildSearchKey(trimmed, activeType, activeSource);
    if (lastStartedSearchKeyRef.current === searchKey) return;
    handleSearch(trimmed, { updateUrl: false }).catch(logAsyncError("search:url-query"));
  }, [activeSource, activeType, handleSearch, initialQuery]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleSearch().catch(logAsyncError("search:submit"));
  }

  const handleCollectPlaylist = async (playlist: PlaylistInfo) => {
    const key = `${playlist.source}:${playlist.id}`;
    setBusyPlaylistKey(key);
    setActionStatus("");
    try {
      if (playlist.source === "wy") {
        if (!wyAccount) {
          await wyLoad();
        }
        await wySetSubscribed(playlist.id, true);
        setActionStatus("已收藏到网易云账号");
        return;
      }

      if (playlist.source === "tx") {
        const marker = buildImportedPlaylistMarker(playlist);
        const existing = localPlaylists.find((item) => item.description?.includes(marker));
        if (existing) {
          setActionStatus(`本地歌单已存在：${existing.name}`);
          return;
        }

        const provider = registry.get("tx");
        if (!provider) throw new Error("未找到 QQ 音乐源");
        const songs = await provider.getPlaylistDetail(playlist);
        const description = [playlist.desc, marker].filter(Boolean).join("\n");
        const created = importPlaylist(playlist.name, description || marker, songs);
        if (playlist.picUrl) {
          updatePlaylistCover(created.id, playlist.picUrl);
        }
        setActionStatus(`已收藏到本地歌单：${created.name}`);
      }
    } catch (err) {
      setActionStatus(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyPlaylistKey(null);
    }
  };

  const handleTypeChange = (type: SearchType) => {
    setActiveType(type);
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);
    setSearchError("");
    setUnavailableMessage("");
    setActionStatus("");
    if (query.trim()) handleSearch(query, { type }).catch(logAsyncError("search:change-type"));
  };

  const handleSourceChange = (source: SearchSource) => {
    setActiveSource(source);
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);
    setSearchError("");
    setUnavailableMessage("");
    setActionStatus("");
    if (query.trim()) handleSearch(query, { source }).catch(logAsyncError("search:change-source"));
  };

  const songGroups = groupSongResults(songResults);
  const playableSongQueue = songGroups.map((group) => ({
    ...group.primary,
    variants: group.variants,
  } as MusicInfo & { variants: MusicInfo[] }));
  const resultCount =
    activeType === "song"
      ? songGroups.length
      : activeType === "playlist"
      ? playlistResults.length
      : artistResults.length;

  return (
    <div className="af-search-view af-animate-slide-in">
      <form className="af-search-hero" onSubmit={handleSubmit} role="search">
        <label htmlFor="search-input" className="af-sr-only">
          搜索
        </label>
        <input
          id="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索歌曲、歌手、专辑…"
          className="af-search-input"
        />
        <button type="submit" className="af-search-submit">
          搜索
        </button>
      </form>

      <div className="af-search-tabs" role="tablist" aria-label="搜索分类">
        <button
          type="button"
          role="tab"
          aria-selected={activeType === "song"}
          className={activeType === "song" ? "af-tab-active" : ""}
          onClick={() => handleTypeChange("song")}
        >
          单曲
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeType === "playlist"}
          className={activeType === "playlist" ? "af-tab-active" : ""}
          onClick={() => handleTypeChange("playlist")}
        >
          歌单
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeType === "singer"}
          className={activeType === "singer" ? "af-tab-active" : ""}
          onClick={() => handleTypeChange("singer")}
        >
          歌手
        </button>
      </div>

      <div className="af-search-source-tabs" role="tablist" aria-label="搜索音源">
        <button className={activeSource === "all" ? "af-tab-active" : ""} onClick={() => handleSourceChange("all")}>综合</button>
        <button className={activeSource === "wy" ? "af-tab-active" : ""} onClick={() => handleSourceChange("wy")}>网易云</button>
        <button className={activeSource === "tx" ? "af-tab-active" : ""} onClick={() => handleSourceChange("tx")}>QQ 音乐</button>
      </div>

      {actionStatus && <div className="af-search-action-status">{actionStatus}</div>}

      {loading && (
        <div className="af-skeleton-list" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="af-skeleton-row" />
          ))}
        </div>
      )}

      {!loading && unavailableMessage && (
        <div className="af-empty-state">
          <p>该功能未开放</p>
          <span>{unavailableMessage}</span>
        </div>
      )}

      {!loading && !unavailableMessage && searchError && (
        <div className="af-empty-state">
          <p>搜索失败</p>
          <span>{searchError}</span>
        </div>
      )}

      {!loading && searched && !unavailableMessage && !searchError && resultCount === 0 && (
        <div className="af-empty-state">
          <p>没有找到相关内容</p>
          <span>可以切换音源，或者换个关键词试试</span>
        </div>
      )}

      {!loading && !unavailableMessage && !searchError && activeType === "song" && songGroups.length > 0 && (
        <ul className="af-search-results">
          {songGroups.map((group, index) => {
            const music = playableSongQueue[index];
            return (
              <li
                key={group.key}
                className="af-search-result-item"
                onClick={() => playQueue(playableSongQueue, index)}
                title="单击播放"
              >
                <span className="af-result-index">{index + 1}</span>
                <div className="af-result-cover">
                  {music.img || music.picUrl ? (
                    <img src={music.img || music.picUrl} alt="" />
                  ) : (
                    <div className="af-cover-placeholder" />
                  )}
                </div>
                <div className="af-result-info">
                  <div className="af-result-title" title={music.name}>{music.name}</div>
                  <div className="af-result-subtitle" title={music.singer}>{music.singer}</div>
                </div>
                <div className="af-result-source af-result-source-group">
                  {group.sources.map((source) => (
                    <span key={source} className={`af-source-badge af-source-${source}`}>{source.toUpperCase()}</span>
                  ))}
                </div>
                <div className="af-result-duration">{formatDuration(music.interval ?? 0)}</div>
                <div className="af-result-actions">
                  <button
                    className="af-action-btn"
                    onClick={(e) => { e.stopPropagation(); playQueue(playableSongQueue, index); }}
                    title="播放"
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="af-action-btn"
                    onClick={(e) => { e.stopPropagation(); usePlayerStore.getState().addToQueue(music); }}
                    title="加入播放队列"
                  >
                    <Plus size={16} />
                  </button>
                  <SongAddMenuButton
                    song={music}
                    iconSize={16}
                    title="添加到我的喜欢或歌单"
                  />
                  <DownloadQualityButton
                    song={music}
                    iconSize={16}
                    title="下载"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !unavailableMessage && !searchError && activeType === "playlist" && playlistResults.length > 0 && (
        <ul className="af-search-results">
          {playlistResults.map((playlist) => (
            (() => {
              const playlistKey = `${playlist.source}:${playlist.id}`;
              const importedMarker = buildImportedPlaylistMarker(playlist);
              const isCollected = playlist.source === "wy"
                ? wyCollectedIds.has(playlist.id)
                : importedPlaylistMarkers.has(importedMarker);
              const collectTitle = isCollected
                ? "已收藏"
                : playlist.source === "wy"
                  ? "收藏到网易云账号"
                  : "收藏到本地歌单";
              return (
            <li
              key={`${playlist.source}:${playlist.id}`}
              className="af-search-result-item"
              onClick={() => {
                navigate(buildPlaylistDetailPath(playlist), { state: { playlist } });
              }}
              title="打开歌单"
            >
              <span className="af-result-index"><Music2 size={16} /></span>
              <div className="af-result-cover">
                {playlist.picUrl ? <img src={playlist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
              </div>
              <div className="af-result-info">
                <div className="af-result-title" title={playlist.name}>{playlist.name}</div>
                <div className="af-result-subtitle" title={playlist.author}>{playlist.author || "未知创建者"}</div>
              </div>
              <div className="af-result-source">{playlist.source.toUpperCase()}</div>
              <div className="af-result-duration">{playlist.playCount ? `${Math.round(playlist.playCount / 10000)}万播放` : "--"}</div>
              <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                <>
                  <button
                    className="af-action-btn"
                    onClick={() => { void handleCollectPlaylist(playlist); }}
                    disabled={busyPlaylistKey === playlistKey || isCollected}
                    title={collectTitle}
                    aria-label={collectTitle}
                  >
                    {isCollected
                      ? <BookmarkCheck size={16} />
                      : <Bookmark size={16} />}
                  </button>
                  <span
                    className="af-search-open-text"
                    onClick={() => navigate(buildPlaylistDetailPath(playlist), { state: { playlist } })}
                    style={{ cursor: "pointer" }}
                  >打开</span>
                </>
              </div>
            </li>
              );
            })()
          ))}
        </ul>
      )}

      {!loading && !unavailableMessage && !searchError && activeType === "singer" && artistResults.length > 0 && (
        <ul className="af-search-results">
          {artistResults.map((artist) => (
            <li
              key={`${artist.source}:${artist.id}`}
              className="af-search-result-item"
              onClick={() => {
                if (artist.source === "wy") navigate(`/artist/${artist.id}`);
              }}
              title={artist.source === "wy" ? "打开歌手详情" : "暂不支持打开歌手详情"}
            >
              <span className="af-result-index"><User size={16} /></span>
              <div className="af-result-cover">
                {artist.picUrl ? <img src={artist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
              </div>
              <div className="af-result-info">
                <div className="af-result-title" title={artist.name}>{artist.name}</div>
                <div className="af-result-subtitle">
                  {artist.musicSize ? `${artist.musicSize} 首作品` : ""}
                  {artist.albumSize ? ` · ${artist.albumSize} 张专辑` : ""}
                </div>
              </div>
              <div className="af-result-source">{artist.source.toUpperCase()}</div>
              <div className="af-result-duration"></div>
              <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                {artist.source === "wy" ? (
                  <span className="af-search-open-text">打开</span>
                ) : (
                  <span className="af-search-open-text">暂不支持详情</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .af-search-source-tabs {
          display: flex;
          gap: 8px;
          margin: 10px 0 18px;
        }

        .af-search-source-tabs button {
          padding: 8px 14px;
          border: 1px solid var(--af-border-primary);
          border-radius: 999px;
          background: var(--af-bg-secondary);
          color: var(--af-text-secondary);
          cursor: pointer;
        }

        .af-search-source-tabs button.af-tab-active {
          color: var(--af-accent-primary);
          border-color: rgba(var(--af-accent-primary-rgb), 0.45);
          background: rgba(var(--af-accent-primary-rgb), 0.1);
        }

        .af-search-open-text {
          font-size: 13px;
          color: var(--af-text-secondary);
          white-space: nowrap;
        }

        .af-search-action-status {
          margin: -4px 0 12px;
          color: var(--af-text-tertiary);
          font-size: var(--af-font-size-sm);
        }

        .af-result-source-group {
          display: flex;
          align-items: center;
          gap: 6px;
          justify-content: flex-start;
        }

        .af-source-badge {
          min-width: 32px;
          padding: 3px 7px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          text-align: center;
          border: 1px solid transparent;
        }

        .af-source-wy {
          color: var(--af-accent-primary);
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          border-color: rgba(var(--af-accent-primary-rgb), 0.28);
        }

        .af-source-tx {
          color: #a78bfa;
          background: rgba(167, 139, 250, 0.12);
          border-color: rgba(167, 139, 250, 0.28);
        }
      `}</style>
    </div>
  );
}
