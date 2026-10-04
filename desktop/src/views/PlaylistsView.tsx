import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { exportPlaylists, importPlaylists } from '@/services/playlistTransferService';
import { fetchPlaylistSongsFromLink } from '@/services/playlistLinkImportService';
import { parsePlaylistLink } from '@lx/core';
import { CARD_COVER_CSS_SIZE, ROW_COVER_CSS_SIZE, coverSrc } from '@/utils/imageReferrerPolicy';
import {
  Plus,
  Music,
  MoreVertical,
  Trash2,
  Edit2,
  Copy,
  Heart,
  History,
  Download,
  Layers,
  Link2,
  Upload,
  RefreshCw,
} from 'lucide-react';

export function PlaylistsView() {
  const navigate = useNavigate();
  const { playlists, createPlaylist, deletePlaylist, duplicatePlaylist, renamePlaylist, updatePlaylistDescription, importPlaylist } = usePlaylistStore();
  const favorites = useFavoritesStore((s) => s.favorites);
  const history = useHistoryStore((s) => s.history);
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyLoading = useWyAccountStore((s) => s.isLoading);
  const wyLoaded = useWyAccountStore((s) => s.isLoaded);
  const wyError = useWyAccountStore((s) => s.error);
  const wyPreloadSongs = useWyAccountStore((s) => s.preloadPlaylistSongs);
  const wyRefreshPlaylists = useWyAccountStore((s) => s.refreshPlaylists);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState('');
  const [wyRefreshing, setWyRefreshing] = useState(false);
  // 链接导入歌单
  const [showImportLinkDialog, setShowImportLinkDialog] = useState(false);
  const [importLink, setImportLink] = useState('');
  const [importLinkName, setImportLinkName] = useState('');
  const [importLinkBusy, setImportLinkBusy] = useState(false);
  const importRequest = useRef<symbol | null>(null);
  const createDialogRef = useRef<HTMLDivElement>(null);
  const importDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { importRequest.current = null; }, []);

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setEditingPlaylist(null);
  };

  const closeImportLinkDialog = () => {
    importRequest.current = null;
    setImportLinkBusy(false);
    setShowImportLinkDialog(false);
  };

  useDialogFocus({ open: showCreateDialog, containerRef: createDialogRef, onClose: closeCreateDialog });
  useDialogFocus({ open: showImportLinkDialog, containerRef: importDialogRef, onClose: closeImportLinkDialog });

  const myWyPlaylists = wyPlaylists.filter((p) => !p.subscribed);
  const collectedWyPlaylists = wyPlaylists.filter((p) => p.subscribed);
  const totalPlaylistCount = 2 + wyPlaylists.length + playlists.length;
  const firstFavoriteCover = coverSrc(favorites[0]?.img || favorites[0]?.picUrl || "", ROW_COVER_CSS_SIZE);
  const firstHistoryCover = coverSrc(history[0]?.img || history[0]?.picUrl || "", ROW_COVER_CSS_SIZE);

  useEffect(() => {
    if (!showCreateDialog && !showImportLinkDialog) return;
    document.documentElement.classList.add('af-page-scroll-locked');
    return () => {
      document.documentElement.classList.remove('af-page-scroll-locked');
    };
  }, [showCreateDialog, showImportLinkDialog]);

  const handleCreate = () => {
    const name = newPlaylistName.trim();
    if (!name) return;

    if (editingPlaylist) {
      renamePlaylist(editingPlaylist, name);
      updatePlaylistDescription(editingPlaylist, newPlaylistDesc.trim() || '');
      setEditingPlaylist(null);
    } else {
      const playlist = createPlaylist(name, newPlaylistDesc.trim() || undefined);
      navigate(`/playlist/${playlist.id}`);
    }
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateDialog(false);
  };

  const handleStartEdit = (id: string) => {
    const pl = playlists.find(p => p.id === id);
    if (pl) {
      setNewPlaylistName(pl.name);
      setNewPlaylistDesc(pl.description || '');
      setEditingPlaylist(id);
      setShowCreateDialog(true);
      setActiveMenu(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个歌单吗？')) {
      deletePlaylist(id);
      setActiveMenu(null);
    }
  };

  const handleDuplicate = (id: string) => {
    const duplicated = duplicatePlaylist(id);
    setActiveMenu(null);
    navigate(`/playlist/${duplicated.id}`);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const openCreateDialog = () => {
    setEditingPlaylist(null);
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateDialog(true);
  };

  const handleImportLink = async () => {
    if (importRequest.current) return;
    const request = Symbol('playlist-link-import');
    importRequest.current = request;
    setImportLinkBusy(true);
    try {
      const { songs } = await fetchPlaylistSongsFromLink(importLink);
      if (importRequest.current !== request) return;
      const name = importLinkName.trim() || '导入的歌单';
      const playlist = importPlaylist(name, undefined, songs);
      setTransferStatus(`已从链接导入「${name}」（${songs.length} 首）`);
      closeImportLinkDialog();
      setImportLink('');
      setImportLinkName('');
      void navigate(`/playlist/${playlist.id}`);
    } catch (error) {
      if (importRequest.current === request) setTransferStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (importRequest.current === request) {
        importRequest.current = null;
        setImportLinkBusy(false);
      }
    }
  };

  const handleExportAll = async () => {
    if (playlists.length === 0) {
      setTransferStatus('没有可导出的本地歌单');
      return;
    }
    setTransferStatus('导出中...');
    try {
      const saved = await exportPlaylists(playlists);
      setTransferStatus(saved ? `已导出 ${playlists.length} 个歌单` : '已取消导出');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async () => {
    setTransferStatus('导入中...');
    try {
      const count = await importPlaylists();
      setTransferStatus(count > 0 ? `已导入 ${count} 个歌单` : '已取消导入');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportOne = async (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    setActiveMenu(null);
    if (!pl) return;
    try {
      const saved = await exportPlaylists([pl]);
      setTransferStatus(saved ? `已导出「${pl.name}」` : '已取消导出');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRefreshWyPlaylists = async () => {
    if (!wyAccount || wyRefreshing) return;
    setWyRefreshing(true);
    try {
      await wyRefreshPlaylists();
    } finally {
      setWyRefreshing(false);
    }
  };

  return (
    <div className="af-playlists-view">
      <div className="af-playlists-header">
        <div>
          <span className="af-page-kicker">Library</span>
          <h1>我的歌单</h1>
          <p>{totalPlaylistCount} 个歌单入口 · 管理收藏、网易云歌单和本地歌单</p>
        </div>
        <div className="af-playlists-header-actions">
          <button
            className="af-create-playlist-btn af-btn-secondary"
            onClick={handleImport}
            title="从 JSON 文件导入歌单"
          >
            <Upload size={18} />
            <span>导入</span>
          </button>
          <button
            className="af-create-playlist-btn af-btn-secondary"
            onClick={() => { setTransferStatus(''); setShowImportLinkDialog(true); }}
            title="从网易云 / QQ 音乐歌单链接导入"
          >
            <Link2 size={18} />
            <span>链接</span>
          </button>
          <button
            className="af-create-playlist-btn af-btn-secondary"
            onClick={handleExportAll}
            disabled={playlists.length === 0}
            title="导出全部本地歌单为 JSON"
          >
            <Download size={18} />
            <span>导出</span>
          </button>
          <button
            className="af-create-playlist-btn"
            onClick={openCreateDialog}
          >
            <Plus size={18} />
            <span>创建歌单</span>
          </button>
        </div>
        {transferStatus && <p className="af-transfer-status">{transferStatus}</p>}
      </div>

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>快捷入口</h2>
            <p>这里只保留已经接通的播放入口</p>
          </div>
        </div>

        <div className="af-quick-grid">
          <button
            type="button"
            className="af-quick-card"
            onClick={() => navigate('/playlist/favorites')}
          >
            <span className="af-quick-cover">
              {firstFavoriteCover ? (
                <img src={firstFavoriteCover} alt="" />
              ) : (
                <Heart size={24} fill="currentColor" />
              )}
            </span>
            <span className="af-quick-content">
              <strong>我喜欢的音乐</strong>
              <small>{favorites.length} 首歌曲</small>
            </span>
          </button>
          <button
            type="button"
            className="af-quick-card"
            onClick={() => navigate('/history')}
          >
            <span className="af-quick-cover">
              {firstHistoryCover ? (
                <img src={firstHistoryCover} alt="" />
              ) : (
                <History size={24} />
              )}
            </span>
            <span className="af-quick-content">
              <strong>播放历史</strong>
              <small>{history.length} 首歌曲</small>
            </span>
          </button>
        </div>
      </section>

      {wyAccount ? (
      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>
              网易云歌单
              <button
                type="button"
                className="af-icon-btn"
                onClick={() => void handleRefreshWyPlaylists()}
                disabled={!wyAccount || wyLoading || wyRefreshing}
                title="刷新网易云歌单"
                aria-label="刷新网易云歌单"
              >
                <RefreshCw size={16} className={wyRefreshing ? 'af-spin' : ''} />
              </button>
            </h2>
            <p>{wyAccount ? `${wyAccount.nickname} 的云端歌单` : '登录后同步你的网易云歌单'}</p>
          </div>
          <span className="af-section-count">{wyPlaylists.length}</span>
        </div>

        {wyLoading && (
          <div className="af-inline-state">正在加载网易云歌单...</div>
        )}

        {!wyLoading && wyError && (
          <div className="af-inline-state af-inline-error">{wyError}</div>
        )}

        {!wyLoading && !wyError && wyLoaded && wyPlaylists.length === 0 && (
          <div className="af-inline-state">还没有同步到网易云歌单</div>
        )}

        {!wyLoading && wyPlaylists.length > 0 && (
          <>
            {myWyPlaylists.length > 0 && (
              <div className="af-playlists-grid af-cloud-grid">
                {myWyPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    className="af-playlist-card af-cloud-playlist-card"
                    onMouseEnter={() => wyPreloadSongs(playlist.id)}
                    onFocus={() => wyPreloadSongs(playlist.id)}
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                    <div className="af-playlist-info">
                      <h3 className="af-playlist-name">{playlist.name}</h3>
                      <p className="af-playlist-meta">
                        {playlist.trackCount ?? 0} 首 · {playlist.author || '网易云音乐'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {collectedWyPlaylists.length > 0 && (
              <>
                <div className="af-subsection-title">收藏的歌单</div>
                <div className="af-playlists-grid af-cloud-grid">
                  {collectedWyPlaylists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      className="af-playlist-card af-cloud-playlist-card"
                      onMouseEnter={() => wyPreloadSongs(playlist.id)}
                      onFocus={() => wyPreloadSongs(playlist.id)}
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                    >
                      <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                      <div className="af-playlist-info">
                        <h3 className="af-playlist-name">{playlist.name}</h3>
                        <p className="af-playlist-meta">
                          {playlist.trackCount ?? 0} 首 · {playlist.author || '网易云音乐'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
      ) : null}

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>本地歌单</h2>
            <p>你在 AuralFlow 中创建和整理的歌单</p>
          </div>
          <span className="af-section-count">{playlists.length}</span>
        </div>

        {playlists.length > 0 ? (
          <div className="af-playlists-grid">
            {playlists.map((playlist) => (
              <div
                key={playlist.id}
                className="af-playlist-card"
              >
                <Link
                  className="af-playlist-cover-wrap"
                  to={`/playlist/${playlist.id}`}
                  aria-label={`打开歌单 ${playlist.name}`}
                  style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
                >
                  <PlaylistCover src={playlist.cover} name={playlist.name} />
                  <div className="af-playlist-overlay">
                    <span className="af-play-all-btn" aria-hidden="true">
                      <Music size={22} />
                    </span>
                  </div>
                </Link>

                <div className="af-playlist-info af-local-playlist-info">
                  <h3 className="af-playlist-name">
                    <Link to={`/playlist/${playlist.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {playlist.name}
                    </Link>
                  </h3>
                  <p className="af-playlist-meta">
                    {playlist.songs.length} 首 · {formatDate(playlist.updatedAt)}
                  </p>

                  <div className="af-playlist-menu">
                    <button
                      className="af-menu-trigger"
                      onClick={() => setActiveMenu(activeMenu === playlist.id ? null : playlist.id)}
                      aria-label="歌单菜单"
                    >
                      <MoreVertical size={18} />
                    </button>

                    {activeMenu === playlist.id && (
                      <div className="af-dropdown-menu">
                        <button onClick={() => handleStartEdit(playlist.id)}>
                          <Edit2 size={16} />
                          <span>编辑信息</span>
                        </button>
                        <button onClick={() => handleDuplicate(playlist.id)}>
                          <Copy size={16} />
                          <span>复制歌单</span>
                        </button>
                        <button onClick={() => handleExportOne(playlist.id)}>
                          <Download size={16} />
                          <span>导出歌单</span>
                        </button>
                        <button
                          className="af-menu-danger"
                          onClick={() => handleDelete(playlist.id)}
                        >
                          <Trash2 size={16} />
                          <span>删除歌单</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="af-inline-state af-local-empty">
            <Music size={32} strokeWidth={1.5} />
            <span>还没有本地歌单，可以创建一个用于临时整理歌曲。</span>
          </div>
        )}
      </section>

      {(showCreateDialog) && (
        <div className="af-dialog-overlay" onClick={closeCreateDialog}>
          <div ref={createDialogRef} className="af-dialog" role="dialog" aria-modal={true}
            aria-label={editingPlaylist ? '编辑歌单' : '创建歌单'} onClick={(e) => e.stopPropagation()}>
            <h2>{editingPlaylist ? '编辑歌单' : '创建歌单'}</h2>
            <div className="af-dialog-body">
              <div className="af-form-group">
                <label htmlFor="playlist-name">歌单名称</label>
                <input
                  id="playlist-name"
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="输入歌单名称"
                  autoFocus
                  maxLength={50}
                />
              </div>
              <div className="af-form-group">
                <label htmlFor="playlist-desc">描述（可选）</label>
                <textarea
                  id="playlist-desc"
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  placeholder="简单介绍一下这个歌单"
                  rows={3}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="af-dialog-actions">
              <button
                className="af-btn-secondary"
                onClick={closeCreateDialog}
              >
                取消
              </button>
              <button
                className="af-btn-primary"
                onClick={handleCreate}
                disabled={!newPlaylistName.trim()}
              >
                {editingPlaylist ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
      {(showImportLinkDialog) && (() => {
        const parsed = importLink.trim() ? parsePlaylistLink(importLink) : null;
        return (
          <div className="af-dialog-overlay" onClick={closeImportLinkDialog}>
            <div ref={importDialogRef} className="af-dialog" role="dialog" aria-modal={true}
              aria-label="从链接导入歌单" onClick={(e) => e.stopPropagation()}>
              <h2>从链接导入歌单</h2>
              <div className="af-dialog-body">
                <div className="af-form-group">
                  <label htmlFor="playlist-link">歌单链接 / ID</label>
                  <input
                    id="playlist-link"
                    type="text"
                    value={importLink}
                    onChange={(e) => setImportLink(e.target.value)}
                    placeholder="粘贴网易云 / QQ 音乐歌单链接或纯数字 ID"
                    autoFocus
                  />
                  {importLink.trim() ? (
                    <p className="af-link-hint" style={{ color: parsed ? 'var(--af-primary, #1db954)' : 'var(--af-danger, #e74c3c)' }}>
                      {parsed
                        ? parsed.source === 'wy' ? '已识别：网易云歌单' : '已识别：QQ 音乐歌单'
                        : '无法识别链接，请检查后重试'}
                    </p>
                  ) : (
                    <p className="af-link-hint">支持网易云与 QQ 音乐歌单分享链接，导入后创建为本地歌单</p>
                  )}
                </div>
                <div className="af-form-group">
                  <label htmlFor="playlist-link-name">歌单名称（可选）</label>
                  <input
                    id="playlist-link-name"
                    type="text"
                    value={importLinkName}
                    onChange={(e) => setImportLinkName(e.target.value)}
                    placeholder="留空使用「导入的歌单」"
                    maxLength={50}
                  />
                </div>
              </div>
              <div className="af-dialog-actions">
                <button className="af-btn-secondary" onClick={closeImportLinkDialog}>
                  取消
                </button>
                <button
                  className="af-btn-primary"
                  onClick={() => void handleImportLink()}
                  disabled={!parsed || importLinkBusy}
                >
                  {importLinkBusy ? '导入中…' : '导入'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function PlaylistCover({ src, name, cloud = false }: { src?: string; name: string; cloud?: boolean }) {
  const imageSrc = coverSrc(src, CARD_COVER_CSS_SIZE);
  return (
    <div className="af-playlist-cover">
      {imageSrc ? (
        <img src={imageSrc} alt={name} />
      ) : (
        <div className="af-playlist-cover-placeholder">
          {cloud ? <Layers size={38} /> : <Music size={42} />}
        </div>
      )}
    </div>
  );
}
